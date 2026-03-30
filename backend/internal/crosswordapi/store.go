package crosswordapi

import (
	"crypto/rand"
	"math/big"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const shareTokenAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
const shareTokenLength = 10

// Puzzle represents a stored crossword puzzle owned by a user.
type Puzzle struct {
	ID            string         `gorm:"primaryKey;type:text" json:"id"`
	UserID        string         `gorm:"index;not null;type:text" json:"-"`
	Title         string         `gorm:"type:text" json:"title"`
	Subtitle      string         `gorm:"type:text" json:"subtitle"`
	Description   string         `gorm:"type:text" json:"description"`
	Topic         string         `gorm:"type:text" json:"topic"`
	ShareToken    string         `gorm:"uniqueIndex;type:text" json:"share_token"`
	Words         []PuzzleWord   `gorm:"foreignKey:PuzzleID;constraint:OnDelete:CASCADE" json:"items"`
	CreatedAt     time.Time      `json:"created_at"`
	Source        string         `gorm:"-" json:"source,omitempty"`
	RewardSummary *RewardSummary `gorm:"-" json:"reward_summary,omitempty"`
}

// PuzzleWord represents a single word entry in a crossword puzzle.
type PuzzleWord struct {
	ID       string `gorm:"primaryKey;type:text" json:"-"`
	PuzzleID string `gorm:"index;not null;type:text" json:"-"`
	Word     string `gorm:"type:text" json:"word"`
	Clue     string `gorm:"type:text" json:"definition"`
	Hint     string `gorm:"type:text" json:"hint"`
}

// UserProfile stores the latest known account information for a user ID.
type UserProfile struct {
	UserID      string    `gorm:"primaryKey;type:text"`
	Email       string    `gorm:"index;type:text"`
	DisplayName string    `gorm:"type:text"`
	AvatarURL   string    `gorm:"type:text"`
	LastSeenAt  time.Time `gorm:"index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// AdminUser is the admin-facing representation of a known account.
type AdminUser struct {
	UserID  string `json:"user_id"`
	Email   string `json:"email"`
	Display string `json:"display"`
}

// AdminGrantRecord captures a successful admin credit grant for audit purposes.
type AdminGrantRecord struct {
	ID           string    `gorm:"primaryKey;type:text" json:"id"`
	AdminUserID  string    `gorm:"index;not null;type:text" json:"admin_user_id"`
	AdminEmail   string    `gorm:"type:text" json:"admin_email"`
	TargetUserID string    `gorm:"index;not null;type:text" json:"target_user_id"`
	TargetEmail  string    `gorm:"type:text" json:"target_email"`
	AmountCoins  int64     `gorm:"not null" json:"amount_coins"`
	Reason       string    `gorm:"type:text;not null" json:"reason"`
	CreatedAt    time.Time `json:"created_at"`
}

// PuzzleSolveRecord captures the first terminal solve outcome for a user+puzzle.
type PuzzleSolveRecord struct {
	ID                    string    `gorm:"primaryKey;type:text" json:"id"`
	PuzzleID              string    `gorm:"uniqueIndex:idx_puzzle_solver;not null;type:text" json:"puzzle_id"`
	PuzzleOwnerUserID     string    `gorm:"index;not null;type:text" json:"puzzle_owner_user_id"`
	SolverUserID          string    `gorm:"uniqueIndex:idx_puzzle_solver;index;not null;type:text" json:"solver_user_id"`
	Source                string    `gorm:"type:text;not null" json:"source"`
	UsedHint              bool      `gorm:"not null;default:false" json:"used_hint"`
	UsedReveal            bool      `gorm:"not null;default:false" json:"used_reveal"`
	OwnerBaseRewardCoins  int64     `gorm:"not null;default:0" json:"owner_base_reward_coins"`
	OwnerNoHintBonusCoins int64     `gorm:"not null;default:0" json:"owner_no_hint_bonus_coins"`
	OwnerDailyBonusCoins  int64     `gorm:"not null;default:0" json:"owner_daily_bonus_coins"`
	SolverRewardCoins     int64     `gorm:"not null;default:0" json:"solver_reward_coins"`
	CreatorRewardCoins    int64     `gorm:"not null;default:0" json:"creator_reward_coins"`
	IneligibilityReason   string    `gorm:"type:text" json:"ineligibility_reason"`
	CreatedAt             time.Time `json:"created_at"`
}

// RewardSummary is the owner-facing reward snapshot returned with stored puzzles.
type RewardSummary struct {
	OwnerRewardStatus         string `json:"owner_reward_status"`
	OwnerRewardClaimTotal     int64  `json:"owner_reward_claim_total"`
	SharedUniqueSolves        int64  `json:"shared_unique_solves"`
	CreatorCreditsEarned      int64  `json:"creator_credits_earned"`
	CreatorPuzzleCapRemaining int64  `json:"creator_puzzle_cap_remaining"`
	CreatorDailyCapRemaining  int64  `json:"creator_daily_cap_remaining"`
}

// PuzzleRewardStats aggregates creator-side stats for a puzzle and owner/day bucket.
type PuzzleRewardStats struct {
	SharedUniqueSolves        int64
	CreatorCreditsEarned      int64
	CreatorCreditsEarnedToday int64
}

// Store defines the persistence operations for puzzles.
type Store interface {
	CreatePuzzle(puzzle *Puzzle) error
	ListPuzzlesByUser(userID string) ([]Puzzle, error)
	GetPuzzle(id string, userID string) (*Puzzle, error)
	GetPuzzleByShareToken(token string) (*Puzzle, error)
	CreateGenerationRequest(record *GenerationRequestRecord) error
	DeletePuzzle(id string, userID string) error
	GetGenerationRequest(userID string, requestID string) (*GenerationRequestRecord, error)
	GetPuzzleSolveRecord(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error)
	CreatePuzzleSolveRecord(record *PuzzleSolveRecord) error
	CountQualifiedOwnerSolvesByDay(userID string, dayStart time.Time, dayEnd time.Time) (int64, error)
	GetPuzzleRewardStats(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error)
	UpdateGenerationRequest(record *GenerationRequestRecord) error
	UpsertUserProfile(profile *UserProfile) error
	ListAdminUsers() ([]AdminUser, error)
	CreateAdminGrantRecord(record *AdminGrantRecord) error
	ListAdminGrantRecords(targetUserID string, limit int) ([]AdminGrantRecord, error)
	UpsertBillingCustomerLink(link *BillingCustomerLink) error
	GetBillingCustomerLink(userID string, provider string) (*BillingCustomerLink, error)
	GetBillingCustomerLinkByPaddleCustomerID(provider string, paddleCustomerID string) (*BillingCustomerLink, error)
	CreateBillingEventRecord(record *BillingEventRecord) error
	ListBillingEventRecords(userID string, provider string, limit int) ([]BillingEventRecord, error)
	GetLatestBillingEventRecordForTransaction(provider string, transactionID string) (*BillingEventRecord, error)
}

// gormStore implements Store using GORM.
type gormStore struct {
	db *gorm.DB
}

// OpenDatabase opens a SQLite database, runs migrations, and returns a Store.
func OpenDatabase(dsn string) (Store, error) {
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(
		&Puzzle{},
		&PuzzleWord{},
		&GenerationRequestRecord{},
		&UserProfile{},
		&AdminGrantRecord{},
		&PuzzleSolveRecord{},
		&BillingCustomerLink{},
		&BillingEventRecord{},
	); err != nil {
		return nil, err
	}
	// Backfill share tokens for any existing puzzles that lack one.
	var empty []Puzzle
	db.Where("share_token = '' OR share_token IS NULL").Find(&empty)
	for i := range empty {
		db.Model(&empty[i]).Update("share_token", generateShareToken())
	}
	return &gormStore{db: db}, nil
}

func generateShareToken() string {
	b := make([]byte, shareTokenLength)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(shareTokenAlphabet))))
		b[i] = shareTokenAlphabet[n.Int64()]
	}
	return string(b)
}

func (s *gormStore) CreatePuzzle(puzzle *Puzzle) error {
	puzzle.ID = uuid.NewString()
	puzzle.ShareToken = generateShareToken()
	for i := range puzzle.Words {
		puzzle.Words[i].ID = uuid.NewString()
		puzzle.Words[i].PuzzleID = puzzle.ID
	}
	return s.db.Create(puzzle).Error
}

func (s *gormStore) ListPuzzlesByUser(userID string) ([]Puzzle, error) {
	var puzzles []Puzzle
	err := s.db.Where(&Puzzle{UserID: userID}).
		Preload("Words").
		Order("created_at desc").
		Find(&puzzles).Error
	return puzzles, err
}

func (s *gormStore) GetPuzzle(id string, userID string) (*Puzzle, error) {
	var puzzle Puzzle
	err := s.db.Where(&Puzzle{ID: id, UserID: userID}).
		Preload("Words").
		First(&puzzle).Error
	if err != nil {
		return nil, err
	}
	return &puzzle, nil
}

func (s *gormStore) GetPuzzleByShareToken(token string) (*Puzzle, error) {
	var puzzle Puzzle
	err := s.db.Where(&Puzzle{ShareToken: token}).
		Preload("Words").
		First(&puzzle).Error
	if err != nil {
		return nil, err
	}
	return &puzzle, nil
}

func (s *gormStore) GetPuzzleSolveRecord(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
	var record PuzzleSolveRecord
	err := s.db.Where(&PuzzleSolveRecord{PuzzleID: puzzleID, SolverUserID: solverUserID}).First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *gormStore) CreatePuzzleSolveRecord(record *PuzzleSolveRecord) error {
	if record == nil {
		return nil
	}
	if record.ID == "" {
		record.ID = uuid.NewString()
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	return s.db.Create(record).Error
}

func (s *gormStore) CountQualifiedOwnerSolvesByDay(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
	var count int64
	err := s.db.Model(&PuzzleSolveRecord{}).
		Where(
			"solver_user_id = ? AND puzzle_owner_user_id = ? AND source = ? AND solver_reward_coins > 0 AND created_at >= ? AND created_at < ?",
			userID,
			userID,
			"owner",
			dayStart,
			dayEnd,
		).
		Count(&count).Error
	return count, err
}

func (s *gormStore) GetPuzzleRewardStats(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
	stats := &PuzzleRewardStats{}

	if err := s.db.Model(&PuzzleSolveRecord{}).
		Where("puzzle_id = ? AND creator_reward_coins > 0", puzzleID).
		Count(&stats.SharedUniqueSolves).Error; err != nil {
		return nil, err
	}

	if err := s.db.Model(&PuzzleSolveRecord{}).
		Where("puzzle_id = ?", puzzleID).
		Select("coalesce(sum(creator_reward_coins), 0)").
		Scan(&stats.CreatorCreditsEarned).Error; err != nil {
		return nil, err
	}

	if err := s.db.Model(&PuzzleSolveRecord{}).
		Where("puzzle_owner_user_id = ? AND creator_reward_coins > 0 AND created_at >= ? AND created_at < ?", ownerUserID, dayStart, dayEnd).
		Select("coalesce(sum(creator_reward_coins), 0)").
		Scan(&stats.CreatorCreditsEarnedToday).Error; err != nil {
		return nil, err
	}

	return stats, nil
}

func (s *gormStore) UpsertUserProfile(profile *UserProfile) error {
	if profile == nil || profile.UserID == "" {
		return nil
	}
	if profile.LastSeenAt.IsZero() {
		profile.LastSeenAt = time.Now().UTC()
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"email":        profile.Email,
			"display_name": profile.DisplayName,
			"avatar_url":   profile.AvatarURL,
			"last_seen_at": profile.LastSeenAt,
			"updated_at":   time.Now().UTC(),
		}),
	}).Create(profile).Error
}

func (s *gormStore) UpsertBillingCustomerLink(link *BillingCustomerLink) error {
	if link == nil {
		return nil
	}
	if link.ID == "" {
		link.ID = uuid.NewString()
	}
	if link.CreatedAt.IsZero() {
		link.CreatedAt = time.Now().UTC()
	}
	link.UpdatedAt = time.Now().UTC()

	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "user_id"},
			{Name: "provider"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"paddle_customer_id": link.PaddleCustomerID,
			"email":              link.Email,
			"updated_at":         link.UpdatedAt,
		}),
	}).Create(link).Error
}

func (s *gormStore) GetBillingCustomerLink(userID string, provider string) (*BillingCustomerLink, error) {
	var link BillingCustomerLink
	err := s.db.Where(&BillingCustomerLink{
		UserID:   userID,
		Provider: provider,
	}).First(&link).Error
	if err != nil {
		return nil, err
	}
	return &link, nil
}

func (s *gormStore) GetBillingCustomerLinkByPaddleCustomerID(provider string, paddleCustomerID string) (*BillingCustomerLink, error) {
	var link BillingCustomerLink
	err := s.db.Where(&BillingCustomerLink{
		Provider:         provider,
		PaddleCustomerID: paddleCustomerID,
	}).First(&link).Error
	if err != nil {
		return nil, err
	}
	return &link, nil
}

func (s *gormStore) CreateBillingEventRecord(record *BillingEventRecord) error {
	if record == nil {
		return nil
	}
	if record.ID == "" {
		record.ID = uuid.NewString()
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	return s.db.Create(record).Error
}

func (s *gormStore) ListBillingEventRecords(userID string, provider string, limit int) ([]BillingEventRecord, error) {
	var records []BillingEventRecord

	query := s.db.Where("user_id = ? AND provider = ?", userID, provider).Order("occurred_at desc, created_at desc")
	if limit <= 0 {
		limit = billingActivityLimit
	}
	err := query.Limit(limit).Find(&records).Error
	return records, err
}

func (s *gormStore) GetLatestBillingEventRecordForTransaction(provider string, transactionID string) (*BillingEventRecord, error) {
	var record BillingEventRecord

	err := s.db.Where("provider = ? AND transaction_id = ?", provider, transactionID).
		Order("occurred_at desc, created_at desc").
		First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *gormStore) ListAdminUsers() ([]AdminUser, error) {
	var profiles []UserProfile
	users := []AdminUser{}

	if err := s.db.Where("trim(email) <> ''").Order("email asc, user_id asc").Find(&profiles).Error; err != nil {
		return nil, err
	}
	for _, profile := range profiles {
		users = append(users, AdminUser{
			UserID:  profile.UserID,
			Email:   profile.Email,
			Display: profile.DisplayName,
		})
	}

	return users, nil
}

func (s *gormStore) CreateAdminGrantRecord(record *AdminGrantRecord) error {
	if record == nil {
		return nil
	}
	if record.ID == "" {
		record.ID = uuid.NewString()
	}
	return s.db.Create(record).Error
}

func (s *gormStore) ListAdminGrantRecords(targetUserID string, limit int) ([]AdminGrantRecord, error) {
	var records []AdminGrantRecord

	if limit <= 0 {
		limit = 20
	}

	err := s.db.Where("target_user_id = ?", targetUserID).
		Order("created_at desc").
		Limit(limit).
		Find(&records).Error
	return records, err
}

func (s *gormStore) DeletePuzzle(id string, userID string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var puzzle Puzzle
		if err := tx.Where(&Puzzle{ID: id, UserID: userID}).First(&puzzle).Error; err != nil {
			return err
		}
		if err := tx.Where(&PuzzleWord{PuzzleID: id}).Delete(&PuzzleWord{}).Error; err != nil {
			return err
		}
		return tx.Delete(&puzzle).Error
	})
}
