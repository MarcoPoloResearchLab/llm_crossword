package crosswordapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// WordItem represents a single crossword word with its clue and hint.
type WordItem struct {
	Word       string `json:"word"`
	Definition string `json:"definition"`
	Hint       string `json:"hint"`
}

// llmProxyResponse is the JSON wrapper returned by llm-proxy with format=application/json.
type llmProxyResponse struct {
	Request  string `json:"request"`
	Response string `json:"response"`
}

var alphaOnly = regexp.MustCompile(`[^A-Za-z]`)

const systemPrompt = `You are a crossword puzzle word generator. Return ONLY a valid JSON array, no markdown fences, no commentary.
Each element must have exactly three fields: "word", "definition", "hint".
Rules:
- "word" must be a single English word, 3-12 letters, alphabetic only (no spaces, hyphens, or numbers).
- "definition" is a concise crossword-style clue (5-15 words).
- "hint" is an additional clue that approaches the answer from a different angle (5-15 words).
- All words must be distinct.
- Words should be thematically related to the given topic.
- Prefer common, well-known words over obscure ones.
- Aim for a mix of word lengths (some short 3-5 letters, some medium 5-8, some longer 8-12).`

func (handler *httpHandler) callLLMProxy(ctx context.Context, topic string, wordCount int) ([]WordItem, error) {
	userPrompt := fmt.Sprintf("Generate exactly %d crossword words about the topic: %q", wordCount, topic)

	params := url.Values{}
	params.Set("prompt", userPrompt)
	params.Set("key", handler.cfg.LLMProxyKey)
	params.Set("format", "application/json")
	params.Set("system_prompt", systemPrompt)

	requestURL := handler.cfg.LLMProxyURL + "/?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build llm request: %w", err)
	}

	resp, err := handler.llmHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llm proxy call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read llm response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("llm proxy returned %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var wrapper llmProxyResponse
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return nil, fmt.Errorf("parse llm wrapper: %w", err)
	}

	responseText := strings.TrimSpace(wrapper.Response)
	responseText = stripMarkdownFences(responseText)

	var items []WordItem
	if err := json.Unmarshal([]byte(responseText), &items); err != nil {
		return nil, fmt.Errorf("parse word list: %w (response: %s)", err, truncate(responseText, 300))
	}

	validated := make([]WordItem, 0, len(items))
	for _, item := range items {
		cleaned := alphaOnly.ReplaceAllString(item.Word, "")
		if len(cleaned) < 2 {
			continue
		}
		if strings.TrimSpace(item.Definition) == "" || strings.TrimSpace(item.Hint) == "" {
			continue
		}
		item.Word = strings.ToUpper(cleaned)
		validated = append(validated, item)
	}

	if len(validated) == 0 {
		return nil, fmt.Errorf("llm returned no valid words")
	}

	return validated, nil
}

func stripMarkdownFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
	}
	return strings.TrimSpace(s)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
