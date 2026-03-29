package crosswordapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCallPuzzleMetadataLLMProxy_ErrorPaths(t *testing.T) {
	t.Run("upstream error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "boom", http.StatusBadGateway)
		}))
		defer server.Close()

		handler := newTestHandler(server)
		_, err := handler.callPuzzleMetadataLLMProxy(context.Background(), "Roman city", []WordItem{
			{Word: "FORUM", Definition: "Public square", Hint: "civic center"},
		})
		if err == nil {
			t.Fatal("expected upstream error")
		}
	})

	t.Run("invalid metadata payload", func(t *testing.T) {
		wrapper := llmProxyResponse{
			Request:  "test",
			Response: `{"title":123,"subtitle":"Valid subtitle","description":"Valid description"}`,
		}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(wrapper)
		}))
		defer server.Close()

		handler := newTestHandler(server)
		_, err := handler.callPuzzleMetadataLLMProxy(context.Background(), "Roman city", []WordItem{
			{Word: "FORUM", Definition: "Public square", Hint: "civic center"},
		})
		if err == nil {
			t.Fatal("expected metadata parse error")
		}
	})
}

func TestParsePuzzleMetadata_AdditionalErrorBranches(t *testing.T) {
	tests := []struct {
		name         string
		responseText string
	}{
		{
			name:         "invalid json",
			responseText: `{`,
		},
		{
			name:         "subtitle becomes empty",
			responseText: `{"title":"Roman city","subtitle":"   ","description":"Valid paragraph"}`,
		},
		{
			name:         "description becomes empty",
			responseText: `{"title":"Roman city","subtitle":"Valid subtitle","description":"   "}`,
		},
		{
			name:         "missing field after length check",
			responseText: `{"title":"Roman city","subtitle":"Valid subtitle","extra":"unexpected"}`,
		},
		{
			name:         "invalid subtitle field type",
			responseText: `{"title":"Roman city","subtitle":7,"description":"Valid paragraph"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parsePuzzleMetadata(tt.responseText, "Roman city")
			if err == nil {
				t.Fatal("expected parse error")
			}
		})
	}
}

func TestNormalizeWhitespace(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{input: "", want: ""},
		{input: "   ", want: ""},
		{input: "  Roman   civic\tcenter  ", want: "Roman civic center"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeWhitespace(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeWhitespace(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestTruncateRunes(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{name: "no truncation", input: "forum", maxLen: 10, want: "forum"},
		{name: "unicode truncation", input: "åßçdé", maxLen: 3, want: "åßç"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateRunes(tt.input, tt.maxLen)
			if got != tt.want {
				t.Fatalf("truncateRunes(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

func TestNormalizeMetadataTitle_Fallbacks(t *testing.T) {
	t.Run("keeps cleaned title", func(t *testing.T) {
		got := normalizeMetadataTitle("  Crossword: Roman civic life  ", "Roman city")
		if strings.Contains(strings.ToLower(got), "crossword") {
			t.Fatalf("expected forbidden word removed, got %q", got)
		}
		if got != "Roman civic life" {
			t.Fatalf("unexpected normalized title: %q", got)
		}
	})

	t.Run("falls back to topic", func(t *testing.T) {
		got := normalizeMetadataTitle("Crossword", "  Roman street grid  ")
		if got != "Roman street grid" {
			t.Fatalf("expected topic fallback, got %q", got)
		}
	})

	t.Run("falls back to untitled topic", func(t *testing.T) {
		got := normalizeMetadataTitle("Crossword", "  crossword  ")
		if got != "Untitled Topic" {
			t.Fatalf("expected untitled fallback, got %q", got)
		}
	})
}
