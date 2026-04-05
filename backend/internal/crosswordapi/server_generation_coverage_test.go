package crosswordapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

func newTestContext(method string, path string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, path, nil)
	return ctx, recorder
}

func TestBuildGenerateRefundIdempotencyKey_BlankRequestIDUsesGeneratedSuffix(t *testing.T) {
	firstKey := buildGenerateRefundIdempotencyKey("generate_failure", "   ")
	secondKey := buildGenerateRefundIdempotencyKey("generate_failure", "")

	if !strings.HasPrefix(firstKey, "refund:generate_failure:") {
		t.Fatalf("expected refund prefix, got %q", firstKey)
	}
	if !strings.HasPrefix(secondKey, "refund:generate_failure:") {
		t.Fatalf("expected refund prefix, got %q", secondKey)
	}
	if firstKey == secondKey {
		t.Fatalf("expected unique refund keys, got %q", firstKey)
	}
}

func TestGenerationRequestMatchesPayload_CoversNilAndMatchCases(t *testing.T) {
	tests := []struct {
		name      string
		record    *GenerationRequestRecord
		topic     string
		wordCount int
		wantMatch bool
	}{
		{
			name:      "nil record",
			record:    nil,
			topic:     "test",
			wordCount: 8,
			wantMatch: false,
		},
		{
			name:      "matching payload",
			record:    &GenerationRequestRecord{Topic: "test", WordCount: 8},
			topic:     "test",
			wordCount: 8,
			wantMatch: true,
		},
		{
			name:      "mismatched payload",
			record:    &GenerationRequestRecord{Topic: "saved", WordCount: 8},
			topic:     "test",
			wordCount: 8,
			wantMatch: false,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := generationRequestMatchesPayload(testCase.record, testCase.topic, testCase.wordCount); got != testCase.wantMatch {
				t.Fatalf("expected %t, got %t", testCase.wantMatch, got)
			}
		})
	}
}

func TestGenerationFailureResponse_CoversAllCases(t *testing.T) {
	tests := []struct {
		name           string
		record         *GenerationRequestRecord
		wantStatusCode int
		wantErrorCode  string
		wantMessage    string
	}{
		{
			name:           "nil record",
			record:         nil,
			wantStatusCode: http.StatusInternalServerError,
			wantErrorCode:  "generation_failed",
			wantMessage:    "generation request could not be completed",
		},
		{
			name:           "insufficient credits",
			record:         &GenerationRequestRecord{ErrorCode: "insufficient_credits"},
			wantStatusCode: http.StatusPaymentRequired,
			wantErrorCode:  "insufficient_credits",
			wantMessage:    "not enough credits to generate a puzzle",
		},
		{
			name:           "ledger error",
			record:         &GenerationRequestRecord{ErrorCode: "ledger_error"},
			wantStatusCode: http.StatusBadGateway,
			wantErrorCode:  "ledger_error",
			wantMessage:    "spend failed",
		},
		{
			name:           "llm timeout",
			record:         &GenerationRequestRecord{ErrorCode: "llm_timeout"},
			wantStatusCode: http.StatusGatewayTimeout,
			wantErrorCode:  "llm_timeout",
			wantMessage:    "the language model took too long — credits have been refunded, please try again",
		},
		{
			name:           "llm error",
			record:         &GenerationRequestRecord{ErrorCode: "llm_error"},
			wantStatusCode: http.StatusBadGateway,
			wantErrorCode:  "llm_error",
			wantMessage:    "failed to generate words — credits have been refunded, please try again",
		},
		{
			name:           "persist failed",
			record:         &GenerationRequestRecord{ErrorCode: "puzzle_persist_failed"},
			wantStatusCode: http.StatusInternalServerError,
			wantErrorCode:  "puzzle_persist_failed",
			wantMessage:    "generated puzzle could not be saved — credits have been refunded, please try again",
		},
		{
			name:           "custom error message",
			record:         &GenerationRequestRecord{ErrorCode: "unknown", ErrorMessage: "custom replay failure"},
			wantStatusCode: http.StatusInternalServerError,
			wantErrorCode:  "generation_failed",
			wantMessage:    "custom replay failure",
		},
		{
			name:           "default fallback message",
			record:         &GenerationRequestRecord{ErrorCode: "unknown"},
			wantStatusCode: http.StatusInternalServerError,
			wantErrorCode:  "generation_failed",
			wantMessage:    "generation request could not be completed",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			statusCode, errorCode, message := generationFailureResponse(testCase.record)
			if statusCode != testCase.wantStatusCode {
				t.Fatalf("expected status %d, got %d", testCase.wantStatusCode, statusCode)
			}
			if errorCode != testCase.wantErrorCode {
				t.Fatalf("expected error code %q, got %q", testCase.wantErrorCode, errorCode)
			}
			if message != testCase.wantMessage {
				t.Fatalf("expected message %q, got %q", testCase.wantMessage, message)
			}
		})
	}
}

func TestBuildGenerateSuccessResponse_NilPuzzle(t *testing.T) {
	balance := &balanceResponse{Coins: 7}
	response := buildGenerateSuccessResponse(nil, balance)

	items, ok := response["items"].([]WordItem)
	if !ok {
		t.Fatalf("expected []WordItem, got %T", response["items"])
	}
	if len(items) != 0 {
		t.Fatalf("expected empty items, got %d", len(items))
	}
	if response["balance"] != balance {
		t.Fatalf("expected balance pointer to be preserved")
	}
}

func TestMarkGenerationRequestHelpers_CoverNoOpAndUpdateErrors(t *testing.T) {
	t.Run("no-op on nil inputs", func(t *testing.T) {
		var nilHandler *httpHandler
		nilHandler.markGenerationRequestFailed(nil, "llm_error", "failed")
		nilHandler.markGenerationRequestSucceeded(nil, "puzzle-1")

		handler := &httpHandler{}
		handler.markGenerationRequestFailed(nil, "llm_error", "failed")
		handler.markGenerationRequestSucceeded(nil, "puzzle-1")
	})

	t.Run("failed mutates record even when update fails", func(t *testing.T) {
		record := &GenerationRequestRecord{
			UserID:    "user-1",
			RequestID: "req-1",
			Status:    generationRequestStatusPending,
			PuzzleID:  "puzzle-1",
		}
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			updateGenerationRequestFunc: func(record *GenerationRequestRecord) error {
				return errors.New("update failed")
			},
		})

		handler.markGenerationRequestFailed(record, "llm_error", "failed to generate")

		if record.Status != generationRequestStatusFailed {
			t.Fatalf("expected failed status, got %q", record.Status)
		}
		if record.ErrorCode != "llm_error" {
			t.Fatalf("expected llm_error, got %q", record.ErrorCode)
		}
		if record.ErrorMessage != "failed to generate" {
			t.Fatalf("expected error message to be preserved, got %q", record.ErrorMessage)
		}
		if record.PuzzleID != "" {
			t.Fatalf("expected puzzle id to be cleared, got %q", record.PuzzleID)
		}
	})

	t.Run("succeeded mutates record even when update fails", func(t *testing.T) {
		record := &GenerationRequestRecord{
			UserID:       "user-1",
			RequestID:    "req-1",
			Status:       generationRequestStatusPending,
			ErrorCode:    "llm_error",
			ErrorMessage: "old failure",
		}
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			updateGenerationRequestFunc: func(record *GenerationRequestRecord) error {
				return errors.New("update failed")
			},
		})

		handler.markGenerationRequestSucceeded(record, "puzzle-2")

		if record.Status != generationRequestStatusSucceeded {
			t.Fatalf("expected succeeded status, got %q", record.Status)
		}
		if record.PuzzleID != "puzzle-2" {
			t.Fatalf("expected puzzle id to be updated, got %q", record.PuzzleID)
		}
		if record.ErrorCode != "" || record.ErrorMessage != "" {
			t.Fatalf("expected errors to be cleared, got %q / %q", record.ErrorCode, record.ErrorMessage)
		}
	})
}

func TestLoadStoredGenerationResponse_CoversErrorsAndSuccess(t *testing.T) {
	t.Run("nil handler returns required error", func(t *testing.T) {
		var nilHandler *httpHandler
		_, err := nilHandler.loadStoredGenerationResponse(context.Background(), "user-1", nil)
		if err == nil || !strings.Contains(err.Error(), "generation request is required") {
			t.Fatalf("expected required error, got %v", err)
		}
	})

	t.Run("missing puzzle id returns error", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		_, err := handler.loadStoredGenerationResponse(context.Background(), "user-1", &GenerationRequestRecord{RequestID: "req-1"})
		if err == nil || !strings.Contains(err.Error(), "missing puzzle id") {
			t.Fatalf("expected missing puzzle id error, got %v", err)
		}
	})

	t.Run("store get puzzle error is returned", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getFunc: func(id string, userID string) (*Puzzle, error) {
				return nil, errors.New("lookup failed")
			},
		})

		_, err := handler.loadStoredGenerationResponse(context.Background(), "user-1", &GenerationRequestRecord{
			RequestID: "req-1",
			PuzzleID:  "puzzle-1",
		})
		if err == nil || !strings.Contains(err.Error(), "lookup failed") {
			t.Fatalf("expected lookup failure, got %v", err)
		}
	})

	t.Run("decorate error is returned", func(t *testing.T) {
		puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-1", Title: "Stored"}
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getFunc: func(id string, userID string) (*Puzzle, error) {
				return puzzle, nil
			},
			getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
				return nil, gorm.ErrRecordNotFound
			},
			getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
				return nil, errors.New("stats failed")
			},
		})

		_, err := handler.loadStoredGenerationResponse(context.Background(), "user-1", &GenerationRequestRecord{
			RequestID: "req-1",
			PuzzleID:  "puzzle-1",
		})
		if err == nil || !strings.Contains(err.Error(), "stats failed") {
			t.Fatalf("expected stats failure, got %v", err)
		}
	})

	t.Run("success ignores balance fetch errors", func(t *testing.T) {
		puzzle := &Puzzle{
			ID:     "puzzle-1",
			UserID: "user-1",
			Title:  "Stored",
			Words: []PuzzleWord{
				{Word: "CAT", Clue: "Animal", Hint: "meow"},
			},
		}
		ledger := &mockLedgerClient{
			getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
				return nil, errors.New("balance unavailable")
			},
		}
		handler := testHandlerWithStore(ledger, nil, &mockStore{
			getFunc: func(id string, userID string) (*Puzzle, error) {
				return puzzle, nil
			},
			getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
				return nil, gorm.ErrRecordNotFound
			},
			getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
				return &PuzzleRewardStats{}, nil
			},
		})

		response, err := handler.loadStoredGenerationResponse(context.Background(), "user-1", &GenerationRequestRecord{
			RequestID: "req-1",
			PuzzleID:  "puzzle-1",
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if response["id"] != "puzzle-1" {
			t.Fatalf("expected puzzle id, got %v", response["id"])
		}
		if _, exists := response["balance"]; !exists {
			t.Fatal("expected balance key to be present")
		}
		if response["source"] != "owned" {
			t.Fatalf("expected owned source, got %v", response["source"])
		}
	})
}

func TestRespondToExistingGenerationRequest_CoversStatuses(t *testing.T) {
	t.Run("nil inputs return false", func(t *testing.T) {
		var nilHandler *httpHandler
		if nilHandler.respondToExistingGenerationRequest(nil, "user-1", nil, "test", 8) {
			t.Fatal("expected nil handler to return false")
		}
	})

	t.Run("mismatched payload returns conflict", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			RequestID: "req-1",
			Topic:     "saved topic",
			WordCount: 8,
			Status:    generationRequestStatusSucceeded,
		}, "different topic", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", recorder.Code)
		}
		body := decodeJSONMap(t, recorder.Body.String())
		if body["error"] != "request_id_conflict" {
			t.Fatalf("expected request_id_conflict, got %v", body["error"])
		}
	})

	t.Run("failed record returns mapped error", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			Status:    generationRequestStatusFailed,
			ErrorCode: "llm_error",
			Topic:     "test",
			WordCount: 8,
		}, "test", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusBadGateway {
			t.Fatalf("expected 502, got %d", recorder.Code)
		}
		body := decodeJSONMap(t, recorder.Body.String())
		if body["error"] != "llm_error" {
			t.Fatalf("expected llm_error, got %v", body["error"])
		}
	})

	t.Run("pending record returns conflict", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			Status:    generationRequestStatusPending,
			Topic:     "test",
			WordCount: 8,
		}, "test", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", recorder.Code)
		}
	})

	t.Run("unknown status returns conflict", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			Status:    "mystery",
			Topic:     "test",
			WordCount: 8,
		}, "test", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", recorder.Code)
		}
	})

	t.Run("succeeded record returns stored response", func(t *testing.T) {
		puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-1", Title: "Stored"}
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getFunc: func(id string, userID string) (*Puzzle, error) {
				return puzzle, nil
			},
			getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
				return nil, gorm.ErrRecordNotFound
			},
			getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
				return &PuzzleRewardStats{}, nil
			},
		})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			Status:    generationRequestStatusSucceeded,
			RequestID: "req-1",
			PuzzleID:  "puzzle-1",
			Topic:     "test",
			WordCount: 8,
		}, "test", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
		}
		body := decodeJSONMap(t, recorder.Body.String())
		if body["id"] != "puzzle-1" {
			t.Fatalf("expected replayed puzzle id, got %v", body["id"])
		}
	})

	t.Run("succeeded replay load failure returns internal error", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		ctx, recorder := newTestContext(http.MethodGet, "/api/generate")

		handled := handler.respondToExistingGenerationRequest(ctx, "user-1", &GenerationRequestRecord{
			Status:    generationRequestStatusSucceeded,
			RequestID: "req-1",
			Topic:     "test",
			WordCount: 8,
		}, "test", 8)
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", recorder.Code)
		}
	})
}

func TestHandleGenerate_CoversRequestLifecycleEdgeCases(t *testing.T) {
	t.Run("request id too long", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{})
		router := testRouterWithClaims(handler, testClaims())
		body := fmt.Sprintf(`{"request_id":"%s","topic":"test","word_count":8}`, strings.Repeat("a", maxGenerateRequestIDLength+1))

		response := doRequest(router, http.MethodPost, "/api/generate", body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("generation request lookup error returns internal error", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return nil, errors.New("lookup failed")
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("existing failed request is replayed", func(t *testing.T) {
		ledger := &mockLedgerClient{
			spendFunc: func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				t.Fatal("spend should not run for replayed failed request")
				return nil, nil
			},
		}
		handler := testHandlerWithStore(ledger, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return &GenerationRequestRecord{
					Status:    generationRequestStatusFailed,
					ErrorCode: "llm_error",
					Topic:     "test",
					WordCount: 8,
				}, nil
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("expected 502, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("existing pending request returns conflict", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return &GenerationRequestRecord{
					Status:    generationRequestStatusPending,
					Topic:     "test",
					WordCount: 8,
				}, nil
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("existing succeeded request with broken replay fails cleanly", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return &GenerationRequestRecord{
					Status:    generationRequestStatusSucceeded,
					RequestID: requestID,
					Topic:     "test",
					WordCount: 8,
				}, nil
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("unique create conflict without replay returns conflict", func(t *testing.T) {
		lookupCalls := 0
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				lookupCalls++
				return nil, gorm.ErrRecordNotFound
			},
			createGenerationRequestFunc: func(record *GenerationRequestRecord) error {
				return errors.New("UNIQUE constraint failed")
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
		}
		if lookupCalls != 2 {
			t.Fatalf("expected 2 lookups, got %d", lookupCalls)
		}
	})

	t.Run("unique create conflict replays stored failure", func(t *testing.T) {
		lookupCalls := 0
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				lookupCalls++
				if lookupCalls == 1 {
					return nil, gorm.ErrRecordNotFound
				}
				return &GenerationRequestRecord{
					Status:    generationRequestStatusFailed,
					ErrorCode: "llm_error",
					Topic:     "test",
					WordCount: 8,
				}, nil
			},
			createGenerationRequestFunc: func(record *GenerationRequestRecord) error {
				return errors.New("duplicate key value violates unique constraint")
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("expected 502, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("create generation request error returns internal error", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return nil, gorm.ErrRecordNotFound
			},
			createGenerationRequestFunc: func(record *GenerationRequestRecord) error {
				return errors.New("insert failed")
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("spend already exists returns conflict", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{
			spendFunc: func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				return nil, status.Error(codes.AlreadyExists, "duplicate spend")
			},
		}, nil, &mockStore{
			getGenerationRequestFunc: func(userID string, requestID string) (*GenerationRequestRecord, error) {
				return nil, gorm.ErrRecordNotFound
			},
		})
		router := testRouterWithClaims(handler, testClaims())

		response := doRequest(router, http.MethodPost, "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
		if response.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
		}
		body := decodeJSONMap(t, response.Body.String())
		if body["error"] != "generation_in_progress" {
			t.Fatalf("expected generation_in_progress, got %v", body["error"])
		}
	})
}
