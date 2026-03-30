package crosswordapi

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
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
		UserID:      "user-1",
		Title:       "Test Puzzle",
		Subtitle:    "A test.",
		Description: "A longer stored description.",
		Topic:       "testing",
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
	if puzzles[0].Description != "A longer stored description." {
		t.Errorf("expected description to persist, got %q", puzzles[0].Description)
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

func TestUserProfiles_AppearInAdminUsers(t *testing.T) {
	s := testStore(t)

	if err := s.UpsertUserProfile(&UserProfile{
		UserID:      "google:123",
		Email:       "alpha@example.com",
		DisplayName: "Alpha",
	}); err != nil {
		t.Fatalf("UpsertUserProfile: %v", err)
	}

	users, err := s.ListAdminUsers()
	if err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(users))
	}
	if users[0].Email != "alpha@example.com" {
		t.Fatalf("expected alpha@example.com, got %q", users[0].Email)
	}
	if users[0].UserID != "google:123" {
		t.Fatalf("expected google:123, got %q", users[0].UserID)
	}
}

func TestListAdminUsers_ExcludesLegacyPuzzleUsersWithoutEmails(t *testing.T) {
	s := testStore(t)

	if err := s.CreatePuzzle(&Puzzle{
		UserID: "google:legacy",
		Title:  "Legacy",
		Words:  []PuzzleWord{{Word: "OLD", Clue: "Older", Hint: "before"}},
	}); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	users, err := s.ListAdminUsers()
	if err != nil {
		t.Fatalf("ListAdminUsers: %v", err)
	}
	if len(users) != 0 {
		t.Fatalf("expected legacy user without email to be omitted, got %v", users)
	}
}

func TestAdminGrantRecords_RoundTrip(t *testing.T) {
	s := testStore(t)

	if err := s.CreateAdminGrantRecord(&AdminGrantRecord{
		AdminUserID:  "admin-1",
		AdminEmail:   "admin@example.com",
		TargetUserID: "target-user",
		TargetEmail:  "target@example.com",
		AmountCoins:  7,
		Reason:       "manual support adjustment",
	}); err != nil {
		t.Fatalf("CreateAdminGrantRecord: %v", err)
	}

	records, err := s.ListAdminGrantRecords("target-user", 20)
	if err != nil {
		t.Fatalf("ListAdminGrantRecords: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].Reason != "manual support adjustment" {
		t.Fatalf("expected reason to round-trip, got %q", records[0].Reason)
	}
	if records[0].AmountCoins != 7 {
		t.Fatalf("expected 7 coins, got %d", records[0].AmountCoins)
	}
}

func TestPuzzleSolveRecords_RoundTripAndStats(t *testing.T) {
	s := testStore(t)

	ownerPuzzle := &Puzzle{
		UserID: "owner-1",
		Title:  "Rewarded",
		Words:  []PuzzleWord{{Word: "ORBIT", Clue: "Path", Hint: "ellipse"}},
	}
	if err := s.CreatePuzzle(ownerPuzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	now := time.Now().UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.Add(24 * time.Hour)

	ownerSolve := &PuzzleSolveRecord{
		PuzzleID:              ownerPuzzle.ID,
		PuzzleOwnerUserID:     "owner-1",
		SolverUserID:          "owner-1",
		Source:                "owner",
		OwnerBaseRewardCoins:  3,
		OwnerNoHintBonusCoins: 1,
		OwnerDailyBonusCoins:  1,
		SolverRewardCoins:     5,
		CreatedAt:             now,
	}
	if err := s.CreatePuzzleSolveRecord(ownerSolve); err != nil {
		t.Fatalf("CreatePuzzleSolveRecord owner: %v", err)
	}

	sharedSolve := &PuzzleSolveRecord{
		PuzzleID:           ownerPuzzle.ID,
		PuzzleOwnerUserID:  "owner-1",
		SolverUserID:       "solver-1",
		Source:             "shared",
		CreatorRewardCoins: 1,
		CreatedAt:          now,
	}
	if err := s.CreatePuzzleSolveRecord(sharedSolve); err != nil {
		t.Fatalf("CreatePuzzleSolveRecord shared: %v", err)
	}

	gotOwnerSolve, err := s.GetPuzzleSolveRecord(ownerPuzzle.ID, "owner-1")
	if err != nil {
		t.Fatalf("GetPuzzleSolveRecord: %v", err)
	}
	if gotOwnerSolve.SolverRewardCoins != 5 {
		t.Fatalf("expected owner reward of 5, got %d", gotOwnerSolve.SolverRewardCoins)
	}

	ownerCount, err := s.CountQualifiedOwnerSolvesByDay("owner-1", dayStart, dayEnd)
	if err != nil {
		t.Fatalf("CountQualifiedOwnerSolvesByDay: %v", err)
	}
	if ownerCount != 1 {
		t.Fatalf("expected 1 qualified owner solve, got %d", ownerCount)
	}

	stats, err := s.GetPuzzleRewardStats(ownerPuzzle.ID, "owner-1", dayStart, dayEnd)
	if err != nil {
		t.Fatalf("GetPuzzleRewardStats: %v", err)
	}
	if stats.SharedUniqueSolves != 1 {
		t.Fatalf("expected 1 shared unique solve, got %d", stats.SharedUniqueSolves)
	}
	if stats.CreatorCreditsEarned != 1 {
		t.Fatalf("expected 1 creator credit earned, got %d", stats.CreatorCreditsEarned)
	}
	if stats.CreatorCreditsEarnedToday != 1 {
		t.Fatalf("expected 1 creator credit earned today, got %d", stats.CreatorCreditsEarnedToday)
	}
}

func TestPuzzleSolveRecords_EnforceUniquePuzzleSolver(t *testing.T) {
	s := testStore(t)

	puzzle := &Puzzle{
		UserID: "owner-1",
		Title:  "Unique",
		Words:  []PuzzleWord{{Word: "ATOM", Clue: "Particle", Hint: "matter"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	firstSolve := &PuzzleSolveRecord{
		PuzzleID:          puzzle.ID,
		PuzzleOwnerUserID: "owner-1",
		SolverUserID:      "solver-1",
		Source:            "shared",
	}
	if err := s.CreatePuzzleSolveRecord(firstSolve); err != nil {
		t.Fatalf("CreatePuzzleSolveRecord first: %v", err)
	}

	secondSolve := &PuzzleSolveRecord{
		PuzzleID:          puzzle.ID,
		PuzzleOwnerUserID: "owner-1",
		SolverUserID:      "solver-1",
		Source:            "shared",
	}
	if err := s.CreatePuzzleSolveRecord(secondSolve); err == nil {
		t.Fatal("expected duplicate puzzle+solver solve record to fail")
	}
}

func TestCreatePuzzleSolveRecord_NilRecord(t *testing.T) {
	s := testStore(t)
	if err := s.CreatePuzzleSolveRecord(nil); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestGetPuzzleRewardStats_QueryErrors(t *testing.T) {
	for _, failQueryIndex := range []int{1, 2, 3} {
		t.Run(string(rune('0'+failQueryIndex)), func(t *testing.T) {
			s := testStore(t)
			gs, ok := s.(*gormStore)
			if !ok {
				t.Fatal("expected gormStore")
			}

			callbackName := "test_fail_query_stats_" + string(rune('0'+failQueryIndex))
			queryCount := 0
			failOnNthQuery := func(db *gorm.DB) {
				queryCount++
				if queryCount == failQueryIndex {
					db.AddError(errors.New("forced query failure"))
				}
			}
			if err := gs.db.Callback().Query().Before("gorm:query").Register(callbackName, failOnNthQuery); err != nil {
				t.Fatalf("register callback: %v", err)
			}
			if err := gs.db.Callback().Raw().Before("gorm:raw").Register(callbackName, failOnNthQuery); err != nil {
				t.Fatalf("register raw callback: %v", err)
			}
			if err := gs.db.Callback().Row().Before("gorm:row").Register(callbackName, failOnNthQuery); err != nil {
				t.Fatalf("register row callback: %v", err)
			}
			defer func() {
				_ = gs.db.Callback().Query().Remove(callbackName)
				_ = gs.db.Callback().Raw().Remove(callbackName)
				_ = gs.db.Callback().Row().Remove(callbackName)
			}()

			_, err := gs.GetPuzzleRewardStats("puzzle-1", "owner-1", time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour))
			if err == nil {
				t.Fatalf("expected query %d to fail", failQueryIndex)
			}
		})
	}
}

// mockStore implements Store for handler testing.
type mockStore struct {
	createFunc                                    func(puzzle *Puzzle) error
	createGenerationRequestFunc                   func(record *GenerationRequestRecord) error
	listFunc                                      func(userID string) ([]Puzzle, error)
	getFunc                                       func(id, userID string) (*Puzzle, error)
	deleteFunc                                    func(id, userID string) error
	getGenerationRequestFunc                      func(userID string, requestID string) (*GenerationRequestRecord, error)
	getByShareFunc                                func(token string) (*Puzzle, error)
	getSolveRecordFunc                            func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error)
	createSolveRecordFunc                         func(record *PuzzleSolveRecord) error
	countOwnerSolvesFunc                          func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error)
	getRewardStatsFunc                            func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error)
	updateGenerationRequestFunc                   func(record *GenerationRequestRecord) error
	upsertUserProfileFunc                         func(profile *UserProfile) error
	listUsersFunc                                 func() ([]AdminUser, error)
	createGrantRecordFunc                         func(record *AdminGrantRecord) error
	listGrantRecordsFunc                          func(targetUserID string, limit int) ([]AdminGrantRecord, error)
	upsertBillingCustomerLinkFunc                 func(link *BillingCustomerLink) error
	getBillingCustomerLinkFunc                    func(userID string, provider string) (*BillingCustomerLink, error)
	getBillingCustomerLinkByPaddleIDFunc          func(provider string, paddleCustomerID string) (*BillingCustomerLink, error)
	createBillingEventRecordFunc                  func(record *BillingEventRecord) error
	listBillingEventRecordsFunc                   func(userID string, provider string, limit int) ([]BillingEventRecord, error)
	getLatestBillingEventRecordForTransactionFunc func(provider string, transactionID string) (*BillingEventRecord, error)
}

func (m *mockStore) CreatePuzzle(puzzle *Puzzle) error {
	if m.createFunc != nil {
		return m.createFunc(puzzle)
	}
	puzzle.ID = "mock-id"
	return nil
}

func (m *mockStore) CreateGenerationRequest(record *GenerationRequestRecord) error {
	if m.createGenerationRequestFunc != nil {
		return m.createGenerationRequestFunc(record)
	}
	if record != nil && record.ID == "" {
		record.ID = "generation-request-id"
	}
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

func (m *mockStore) GetGenerationRequest(userID string, requestID string) (*GenerationRequestRecord, error) {
	if m.getGenerationRequestFunc != nil {
		return m.getGenerationRequestFunc(userID, requestID)
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockStore) GetPuzzleByShareToken(token string) (*Puzzle, error) {
	if m.getByShareFunc != nil {
		return m.getByShareFunc(token)
	}
	return nil, errors.New("not found")
}

func (m *mockStore) GetPuzzleSolveRecord(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
	if m.getSolveRecordFunc != nil {
		return m.getSolveRecordFunc(puzzleID, solverUserID)
	}
	return nil, errors.New("not found")
}

func (m *mockStore) CreatePuzzleSolveRecord(record *PuzzleSolveRecord) error {
	if m.createSolveRecordFunc != nil {
		return m.createSolveRecordFunc(record)
	}
	return nil
}

func (m *mockStore) CountQualifiedOwnerSolvesByDay(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
	if m.countOwnerSolvesFunc != nil {
		return m.countOwnerSolvesFunc(userID, dayStart, dayEnd)
	}
	return 0, nil
}

func (m *mockStore) GetPuzzleRewardStats(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
	if m.getRewardStatsFunc != nil {
		return m.getRewardStatsFunc(puzzleID, ownerUserID, dayStart, dayEnd)
	}
	return &PuzzleRewardStats{}, nil
}

func (m *mockStore) UpdateGenerationRequest(record *GenerationRequestRecord) error {
	if m.updateGenerationRequestFunc != nil {
		return m.updateGenerationRequestFunc(record)
	}
	return nil
}

func (m *mockStore) UpsertUserProfile(profile *UserProfile) error {
	if m.upsertUserProfileFunc != nil {
		return m.upsertUserProfileFunc(profile)
	}
	return nil
}

func (m *mockStore) ListAdminUsers() ([]AdminUser, error) {
	if m.listUsersFunc != nil {
		return m.listUsersFunc()
	}
	return nil, nil
}

func (m *mockStore) CreateAdminGrantRecord(record *AdminGrantRecord) error {
	if m.createGrantRecordFunc != nil {
		return m.createGrantRecordFunc(record)
	}
	return nil
}

func (m *mockStore) ListAdminGrantRecords(targetUserID string, limit int) ([]AdminGrantRecord, error) {
	if m.listGrantRecordsFunc != nil {
		return m.listGrantRecordsFunc(targetUserID, limit)
	}
	return nil, nil
}

func (m *mockStore) UpsertBillingCustomerLink(link *BillingCustomerLink) error {
	if m.upsertBillingCustomerLinkFunc != nil {
		return m.upsertBillingCustomerLinkFunc(link)
	}
	return nil
}

func (m *mockStore) GetBillingCustomerLink(userID string, provider string) (*BillingCustomerLink, error) {
	if m.getBillingCustomerLinkFunc != nil {
		return m.getBillingCustomerLinkFunc(userID, provider)
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockStore) GetBillingCustomerLinkByPaddleCustomerID(provider string, paddleCustomerID string) (*BillingCustomerLink, error) {
	if m.getBillingCustomerLinkByPaddleIDFunc != nil {
		return m.getBillingCustomerLinkByPaddleIDFunc(provider, paddleCustomerID)
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockStore) CreateBillingEventRecord(record *BillingEventRecord) error {
	if m.createBillingEventRecordFunc != nil {
		return m.createBillingEventRecordFunc(record)
	}
	return nil
}

func (m *mockStore) ListBillingEventRecords(userID string, provider string, limit int) ([]BillingEventRecord, error) {
	if m.listBillingEventRecordsFunc != nil {
		return m.listBillingEventRecordsFunc(userID, provider, limit)
	}
	return nil, nil
}

func (m *mockStore) GetLatestBillingEventRecordForTransaction(provider string, transactionID string) (*BillingEventRecord, error) {
	if m.getLatestBillingEventRecordForTransactionFunc != nil {
		return m.getLatestBillingEventRecordForTransactionFunc(provider, transactionID)
	}
	return nil, gorm.ErrRecordNotFound
}
