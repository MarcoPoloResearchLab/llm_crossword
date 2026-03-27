package crosswordapi

import (
	"errors"
	"testing"
)

func testStore(t *testing.T) Store {
	t.Helper()
	s, err := OpenDatabase(":memory:")
	if err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	return s
}

func TestOpenDatabase(t *testing.T) {
	s, err := OpenDatabase(":memory:")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if s == nil {
		t.Fatal("expected non-nil store")
	}
}

func TestCreateAndListPuzzles(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID:   "user-1",
		Title:    "Test Puzzle",
		Subtitle: "A test.",
		Topic:    "testing",
		Words: []PuzzleWord{
			{Word: "HELLO", Clue: "A greeting", Hint: "what you say when you meet someone"},
			{Word: "WORLD", Clue: "The planet", Hint: "Earth"},
		},
	}

	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	if puzzle.ID == "" {
		t.Error("expected puzzle ID to be set")
	}
	for _, w := range puzzle.Words {
		if w.ID == "" {
			t.Error("expected word ID to be set")
		}
		if w.PuzzleID != puzzle.ID {
			t.Errorf("expected word PuzzleID=%s, got %s", puzzle.ID, w.PuzzleID)
		}
	}

	puzzles, err := s.ListPuzzlesByUser("user-1")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 1 {
		t.Fatalf("expected 1 puzzle, got %d", len(puzzles))
	}
	if puzzles[0].Title != "Test Puzzle" {
		t.Errorf("expected title 'Test Puzzle', got %q", puzzles[0].Title)
	}
	if len(puzzles[0].Words) != 2 {
		t.Errorf("expected 2 words, got %d", len(puzzles[0].Words))
	}
}

func TestListPuzzlesByUser_EmptyForNewUser(t *testing.T) {
	s := testStore(t)

	puzzles, err := s.ListPuzzlesByUser("nonexistent-user")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 0 {
		t.Errorf("expected 0 puzzles, got %d", len(puzzles))
	}
}

func TestListPuzzlesByUser_ScopedToUser(t *testing.T) {
	s := testStore(t)

	if err := s.CreatePuzzle(&Puzzle{
		UserID: "user-a",
		Title:  "A's puzzle",
		Words:  []PuzzleWord{{Word: "ALPHA", Clue: "First", Hint: "beginning"}},
	}); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	if err := s.CreatePuzzle(&Puzzle{
		UserID: "user-b",
		Title:  "B's puzzle",
		Words:  []PuzzleWord{{Word: "BETA", Clue: "Second", Hint: "after alpha"}},
	}); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	puzzles, err := s.ListPuzzlesByUser("user-a")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 1 {
		t.Fatalf("expected 1 puzzle for user-a, got %d", len(puzzles))
	}
	if puzzles[0].Title != "A's puzzle" {
		t.Errorf("expected A's puzzle, got %q", puzzles[0].Title)
	}
}

func TestGetPuzzle(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Get Me",
		Words:  []PuzzleWord{{Word: "TEST", Clue: "A trial", Hint: "exam"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	got, err := s.GetPuzzle(puzzle.ID, "user-1")
	if err != nil {
		t.Fatalf("GetPuzzle: %v", err)
	}
	if got.Title != "Get Me" {
		t.Errorf("expected title 'Get Me', got %q", got.Title)
	}
	if len(got.Words) != 1 {
		t.Errorf("expected 1 word, got %d", len(got.Words))
	}
}

func TestGetPuzzle_WrongUser(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Private",
		Words:  []PuzzleWord{{Word: "SECRET", Clue: "Hidden", Hint: "not public"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	_, err := s.GetPuzzle(puzzle.ID, "user-2")
	if err == nil {
		t.Error("expected error when accessing another user's puzzle")
	}
}

func TestGetPuzzle_NotFound(t *testing.T) {
	s := testStore(t)

	_, err := s.GetPuzzle("nonexistent-id", "user-1")
	if err == nil {
		t.Error("expected error for nonexistent puzzle")
	}
}

func TestDeletePuzzle(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Delete Me",
		Words:  []PuzzleWord{{Word: "GONE", Clue: "Removed", Hint: "vanished"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	if err := s.DeletePuzzle(puzzle.ID, "user-1"); err != nil {
		t.Fatalf("DeletePuzzle: %v", err)
	}

	puzzles, err := s.ListPuzzlesByUser("user-1")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 0 {
		t.Errorf("expected 0 puzzles after delete, got %d", len(puzzles))
	}

	// Verify words are also deleted by trying to get the puzzle.
	_, err = s.GetPuzzle(puzzle.ID, "user-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestDeletePuzzle_WrongUser(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Not Yours",
		Words:  []PuzzleWord{{Word: "MINE", Clue: "Belonging to me", Hint: "possessive"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	err := s.DeletePuzzle(puzzle.ID, "user-2")
	if err == nil {
		t.Error("expected error when deleting another user's puzzle")
	}

	// Verify puzzle still exists.
	puzzles, err := s.ListPuzzlesByUser("user-1")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 1 {
		t.Errorf("expected puzzle to still exist, got %d", len(puzzles))
	}
}

func TestDeletePuzzle_NotFound(t *testing.T) {
	s := testStore(t)

	err := s.DeletePuzzle("nonexistent-id", "user-1")
	if err == nil {
		t.Error("expected error for nonexistent puzzle")
	}
}

func TestListPuzzlesByUser_OrderedByCreatedAtDesc(t *testing.T) {
	s := testStore(t)

	if err := s.CreatePuzzle(&Puzzle{
		UserID: "user-1",
		Title:  "First",
		Words:  []PuzzleWord{{Word: "ONE", Clue: "Number", Hint: "1"}},
	}); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	if err := s.CreatePuzzle(&Puzzle{
		UserID: "user-1",
		Title:  "Second",
		Words:  []PuzzleWord{{Word: "TWO", Clue: "Number", Hint: "2"}},
	}); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	puzzles, err := s.ListPuzzlesByUser("user-1")
	if err != nil {
		t.Fatalf("ListPuzzlesByUser: %v", err)
	}
	if len(puzzles) != 2 {
		t.Fatalf("expected 2 puzzles, got %d", len(puzzles))
	}
	if puzzles[0].Title != "Second" {
		t.Errorf("expected newest first, got %q", puzzles[0].Title)
	}
}

func TestCreatePuzzle_SetsShareToken(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Token Test",
		Words:  []PuzzleWord{{Word: "HELLO", Clue: "A greeting", Hint: "hi"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	if puzzle.ShareToken == "" {
		t.Fatal("expected share token to be set")
	}
	if len(puzzle.ShareToken) != 10 {
		t.Errorf("expected 10-char token, got %d: %q", len(puzzle.ShareToken), puzzle.ShareToken)
	}
	for _, c := range puzzle.ShareToken {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			t.Errorf("token contains non-base36 char: %c", c)
		}
	}
}

func TestCreatePuzzle_UniqueShareTokens(t *testing.T) {
	s := testStore(t)

	p1 := &Puzzle{UserID: "user-1", Title: "One", Words: []PuzzleWord{{Word: "A", Clue: "c", Hint: "h"}}}
	p2 := &Puzzle{UserID: "user-1", Title: "Two", Words: []PuzzleWord{{Word: "B", Clue: "c", Hint: "h"}}}
	if err := s.CreatePuzzle(p1); err != nil {
		t.Fatalf("CreatePuzzle p1: %v", err)
	}
	if err := s.CreatePuzzle(p2); err != nil {
		t.Fatalf("CreatePuzzle p2: %v", err)
	}
	if p1.ShareToken == p2.ShareToken {
		t.Errorf("expected different tokens, both got %q", p1.ShareToken)
	}
}

func TestGetPuzzleByShareToken_Success(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Shared Puzzle",
		Words:  []PuzzleWord{{Word: "SHARE", Clue: "Give to others", Hint: "distribute"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	got, err := s.GetPuzzleByShareToken(puzzle.ShareToken)
	if err != nil {
		t.Fatalf("GetPuzzleByShareToken: %v", err)
	}
	if got.Title != "Shared Puzzle" {
		t.Errorf("expected title 'Shared Puzzle', got %q", got.Title)
	}
	if len(got.Words) != 1 {
		t.Errorf("expected 1 word, got %d", len(got.Words))
	}
}

func TestGetPuzzleByShareToken_NotFound(t *testing.T) {
	s := testStore(t)

	_, err := s.GetPuzzleByShareToken("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent share token")
	}
}

// mockStore implements Store for handler testing.
type mockStore struct {
	createFunc     func(puzzle *Puzzle) error
	listFunc       func(userID string) ([]Puzzle, error)
	getFunc        func(id, userID string) (*Puzzle, error)
	deleteFunc     func(id, userID string) error
	getByShareFunc func(token string) (*Puzzle, error)
	listUsersFunc  func() ([]string, error)
}

func (m *mockStore) CreatePuzzle(puzzle *Puzzle) error {
	if m.createFunc != nil {
		return m.createFunc(puzzle)
	}
	puzzle.ID = "mock-id"
	return nil
}

func (m *mockStore) ListPuzzlesByUser(userID string) ([]Puzzle, error) {
	if m.listFunc != nil {
		return m.listFunc(userID)
	}
	return nil, nil
}

func (m *mockStore) GetPuzzle(id, userID string) (*Puzzle, error) {
	if m.getFunc != nil {
		return m.getFunc(id, userID)
	}
	return nil, errors.New("not found")
}

func (m *mockStore) DeletePuzzle(id, userID string) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(id, userID)
	}
	return nil
}

func (m *mockStore) GetPuzzleByShareToken(token string) (*Puzzle, error) {
	if m.getByShareFunc != nil {
		return m.getByShareFunc(token)
	}
	return nil, errors.New("not found")
}

func (m *mockStore) ListDistinctUserIDs() ([]string, error) {
	if m.listUsersFunc != nil {
		return m.listUsersFunc()
	}
	return nil, nil
}
