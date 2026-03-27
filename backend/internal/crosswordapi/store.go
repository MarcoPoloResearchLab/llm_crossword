package crosswordapi

import (
	"crypto/rand"
	"math/big"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const shareTokenAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
const shareTokenLength = 10

// Puzzle represents a stored crossword puzzle owned by a user.
type Puzzle struct {
	ID         string       `gorm:"primaryKey;type:text" json:"id"`
	UserID     string       `gorm:"index;not null;type:text" json:"-"`
	Title      string       `gorm:"type:text" json:"title"`
	Subtitle   string       `gorm:"type:text" json:"subtitle"`
	Topic      string       `gorm:"type:text" json:"topic"`
	ShareToken string       `gorm:"uniqueIndex;type:text" json:"share_token"`
	Words      []PuzzleWord `gorm:"foreignKey:PuzzleID;constraint:OnDelete:CASCADE" json:"items"`
	CreatedAt  time.Time    `json:"created_at"`
}

// PuzzleWord represents a single word entry in a crossword puzzle.
type PuzzleWord struct {
	ID       string `gorm:"primaryKey;type:text" json:"-"`
	PuzzleID string `gorm:"index;not null;type:text" json:"-"`
	Word     string `gorm:"type:text" json:"word"`
	Clue     string `gorm:"type:text" json:"definition"`
	Hint     string `gorm:"type:text" json:"hint"`
}

// Store defines the persistence operations for puzzles.
type Store interface {
	CreatePuzzle(puzzle *Puzzle) error
	ListPuzzlesByUser(userID string) ([]Puzzle, error)
	GetPuzzle(id string, userID string) (*Puzzle, error)
	GetPuzzleByShareToken(token string) (*Puzzle, error)
	DeletePuzzle(id string, userID string) error
	ListDistinctUserIDs() ([]string, error)
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
	if err := db.AutoMigrate(&Puzzle{}, &PuzzleWord{}); err != nil {
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

func (s *gormStore) ListDistinctUserIDs() ([]string, error) {
	var userIDs []string
	err := s.db.Model(&Puzzle{}).Distinct("user_id").Order("user_id").Pluck("user_id", &userIDs).Error
	return userIDs, err
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
