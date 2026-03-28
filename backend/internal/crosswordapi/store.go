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
	ID          string       `gorm:"primaryKey;type:text" json:"id"`
	UserID      string       `gorm:"index;not null;type:text" json:"-"`
	Title       string       `gorm:"type:text" json:"title"`
	Subtitle    string       `gorm:"type:text" json:"subtitle"`
	Description string       `gorm:"type:text" json:"description"`
	Topic       string       `gorm:"type:text" json:"topic"`
	ShareToken  string       `gorm:"uniqueIndex;type:text" json:"share_token"`
	Words       []PuzzleWord `gorm:"foreignKey:PuzzleID;constraint:OnDelete:CASCADE" json:"items"`
	CreatedAt   time.Time    `json:"created_at"`
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

// Store defines the persistence operations for puzzles.
type Store interface {
	CreatePuzzle(puzzle *Puzzle) error
	ListPuzzlesByUser(userID string) ([]Puzzle, error)
	GetPuzzle(id string, userID string) (*Puzzle, error)
	GetPuzzleByShareToken(token string) (*Puzzle, error)
	DeletePuzzle(id string, userID string) error
	UpsertUserProfile(profile *UserProfile) error
	ListAdminUsers() ([]AdminUser, error)
	CreateAdminGrantRecord(record *AdminGrantRecord) error
	ListAdminGrantRecords(targetUserID string, limit int) ([]AdminGrantRecord, error)
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
	if err := db.AutoMigrate(&Puzzle{}, &PuzzleWord{}, &UserProfile{}, &AdminGrantRecord{}); err != nil {
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
