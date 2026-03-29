package crosswordapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

// errReader is a reader that always returns an error.
type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, fmt.Errorf("forced read error") }
func (errReader) Close() error             { return nil }

// roundTripFunc allows using a function as an http.RoundTripper.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestStripMarkdownFences(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"no fences", `[{"word":"hello"}]`, `[{"word":"hello"}]`},
		{"json fence", "```json\n[{\"word\":\"hello\"}]\n```", `[{"word":"hello"}]`},
		{"plain fence", "```\n[{\"word\":\"hello\"}]\n```", `[{"word":"hello"}]`},
		{"only opening json fence", "```json\n[{\"word\":\"hello\"}]", `[{"word":"hello"}]`},
		{"only closing fence", "[{\"word\":\"hello\"}]\n```", `[{"word":"hello"}]`},
		{"whitespace around", "  ```json\n[{\"word\":\"hello\"}]\n```  ", `[{"word":"hello"}]`},
		{"empty", "", ""},
		{"just fences", "```json\n```", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripMarkdownFences(tt.input)
			if got != tt.want {
				t.Errorf("stripMarkdownFences(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"short", 10, "short"},
		{"exactly10!", 10, "exactly10!"},
		{"hello world", 5, "hello..."},
		{"", 5, ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := truncate(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

func newTestHandler(llmServer *httptest.Server) *httpHandler {
	logger, _ := zap.NewDevelopment()
	return &httpHandler{
		logger: logger,
		cfg: Config{
			LLMProxyURL:     llmServer.URL,
			LLMProxyKey:     "test-key",
			LLMProxyTimeout: 5 * time.Second,
		},
		llmHTTPClient: llmServer.Client(),
	}
}

func TestCallLLMProxy_Success(t *testing.T) {
	items := []WordItem{
		{Word: "ZEUS", Definition: "King of the gods", Hint: "Ruler of Olympus"},
		{Word: "HERA", Definition: "Queen of the gods", Hint: "Wife of Zeus"},
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: mustMarshal(t, items),
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	result, err := handler.callLLMProxy(context.Background(), "Greek gods", 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result))
	}
	if result[0].Word != "ZEUS" {
		t.Errorf("expected ZEUS, got %s", result[0].Word)
	}
}

func TestCallPuzzleMetadataLLMProxy_Success(t *testing.T) {
	metadata := PuzzleMetadata{
		Title:       "Roman Urban Systems",
		Subtitle:    "Forums, baths, basilicas, and streets shape the final Roman city word list.",
		Description: "This puzzle highlights the civic, commercial, and social structures that organized daily life in a Roman city.",
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: mustMarshal(t, metadata),
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	result, err := handler.callPuzzleMetadataLLMProxy(context.Background(), "Roman city", []WordItem{
		{Word: "FORUM", Definition: "Civic center", Hint: "public square"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Title != metadata.Title {
		t.Fatalf("expected title %q, got %q", metadata.Title, result.Title)
	}
	if result.Subtitle != metadata.Subtitle {
		t.Fatalf("expected subtitle %q, got %q", metadata.Subtitle, result.Subtitle)
	}
	if result.Description != metadata.Description {
		t.Fatalf("expected description %q, got %q", metadata.Description, result.Description)
	}
}

func TestParsePuzzleMetadata_NormalizesTitleAndWhitespace(t *testing.T) {
	metadata, err := parsePuzzleMetadata(`{
		"title":"  Crossword — The organization of a roman city, the main parts and functions of a roman city and its forum  ",
		"subtitle":"  The forum, basilica, and baths anchor the final Roman vocabulary.  ",
		"description":"  A detailed paragraph about Roman streets, markets, baths, and civic spaces.  "
	}`, "Roman city")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(strings.ToLower(metadata.Title), "crossword") {
		t.Fatalf("expected title without forbidden word, got %q", metadata.Title)
	}
	if len([]rune(metadata.Title)) > maxGeneratedTitleLength {
		t.Fatalf("expected title length <= %d, got %d", maxGeneratedTitleLength, len([]rune(metadata.Title)))
	}
	if metadata.Subtitle != "The forum, basilica, and baths anchor the final Roman vocabulary." {
		t.Fatalf("unexpected subtitle normalization: %q", metadata.Subtitle)
	}
	if metadata.Description != "A detailed paragraph about Roman streets, markets, baths, and civic spaces." {
		t.Fatalf("unexpected description normalization: %q", metadata.Description)
	}
}

func TestParsePuzzleMetadata_RejectsMissingField(t *testing.T) {
	_, err := parsePuzzleMetadata(`{"title":"Roman city","subtitle":"Specific civic spaces"}`, "Roman city")
	if err == nil {
		t.Fatal("expected error for missing description")
	}
}

func TestParsePuzzleMetadata_RejectsExtraField(t *testing.T) {
	_, err := parsePuzzleMetadata(`{
		"title":"Roman city",
		"subtitle":"Specific civic spaces",
		"description":"Detailed paragraph",
		"extra":"not allowed"
	}`, "Roman city")
	if err == nil {
		t.Fatal("expected error for extra field")
	}
}

func TestCallLLMProxy_WithMarkdownFences(t *testing.T) {
	items := []WordItem{
		{Word: "APOLLO", Definition: "God of sun", Hint: "Musical deity"},
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: "```json\n" + mustMarshal(t, items) + "\n```",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	result, err := handler.callLLMProxy(context.Background(), "Greek gods", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 1 || result[0].Word != "APOLLO" {
		t.Fatalf("expected APOLLO, got %v", result)
	}
}

func TestCallLLMProxy_NonOKStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	handler := newTestHandler(server)
	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for non-OK status")
	}
}

func TestCallLLMProxy_InvalidWrapperJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	handler := newTestHandler(server)
	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for invalid wrapper JSON")
	}
}

func TestCallLLMProxy_InvalidItemsJSON(t *testing.T) {
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: "not a json array",
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for invalid items JSON")
	}
}

func TestCallLLMProxy_NoValidWords(t *testing.T) {
	// Words too short or missing definition/hint
	items := []WordItem{
		{Word: "A", Definition: "Single letter", Hint: "First letter"},
		{Word: "GOOD", Definition: "", Hint: "Something"},
		{Word: "NICE", Definition: "Something", Hint: ""},
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: mustMarshal(t, items),
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for no valid words")
	}
}

func TestCallLLMProxy_FiltersInvalidWords(t *testing.T) {
	items := []WordItem{
		{Word: "GOOD-WORD", Definition: "Valid def", Hint: "Valid hint"},  // hyphen stripped -> GOODWORD (valid)
		{Word: "A", Definition: "Too short", Hint: "Too short"},           // too short
		{Word: "VALID", Definition: "A valid word", Hint: "A valid hint"}, // valid
		{Word: "123", Definition: "Numbers only", Hint: "Numbers"},        // no alpha left
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: mustMarshal(t, items),
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	result, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 valid items, got %d: %+v", len(result), result)
	}
}

func TestCallLLMProxy_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer server.Close()

	handler := newTestHandler(server)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately
	_, err := handler.callLLMProxy(ctx, "test", 5)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestCallLLMProxy_ReadBodyError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set content-length but close prematurely to cause ReadAll error.
		w.Header().Set("Content-Length", "100000")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("partial"))
		// The server closes the connection, causing ReadAll to get less data
		// than Content-Length promises. However, Go's ReadAll may not error here.
		// Instead we test via a broken URL that can't build a request.
	}))
	defer server.Close()

	handler := newTestHandler(server)
	// Use an invalid URL scheme to trigger NewRequestWithContext error.
	handler.cfg.LLMProxyURL = "://invalid"
	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for invalid URL")
	}
}

func TestCallLLMProxy_ReadBodyErrorViaTransport(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	handler := &httpHandler{
		logger: logger,
		cfg: Config{
			LLMProxyURL:     "http://localhost",
			LLMProxyKey:     "test-key",
			LLMProxyTimeout: 5 * time.Second,
		},
		llmHTTPClient: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(errReader{}),
					Header:     make(http.Header),
				}, nil
			}),
		},
	}

	_, err := handler.callLLMProxy(context.Background(), "test", 5)
	if err == nil {
		t.Fatal("expected error for read body failure")
	}
	if !strings.Contains(err.Error(), "read llm response") {
		t.Fatalf("expected 'read llm response' error, got: %v", err)
	}
}

func mustMarshal(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}
