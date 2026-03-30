package crosswordapi

import (
	"time"

	"github.com/google/uuid"
)

const (
	generationRequestStatusFailed    = "failed"
	generationRequestStatusPending   = "pending"
	generationRequestStatusSucceeded = "succeeded"
)

// GenerationRequestRecord stores the lifecycle of a client generation request.
type GenerationRequestRecord struct {
	ID           string `gorm:"primaryKey;type:text"`
	UserID       string `gorm:"not null;type:text;uniqueIndex:idx_generation_request_user_request"`
	RequestID    string `gorm:"not null;type:text;uniqueIndex:idx_generation_request_user_request"`
	Topic        string `gorm:"type:text"`
	WordCount    int    `gorm:"not null"`
	Status       string `gorm:"not null;type:text;index"`
	PuzzleID     string `gorm:"type:text;index"`
	ErrorCode    string `gorm:"type:text"`
	ErrorMessage string `gorm:"type:text"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (s *gormStore) CreateGenerationRequest(record *GenerationRequestRecord) error {
	if record == nil {
		return nil
	}
	if record.ID == "" {
		record.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	if record.CreatedAt.IsZero() {
		record.CreatedAt = now
	}
	record.UpdatedAt = now
	return s.db.Create(record).Error
}

func (s *gormStore) GetGenerationRequest(userID string, requestID string) (*GenerationRequestRecord, error) {
	var record GenerationRequestRecord

	err := s.db.Where(&GenerationRequestRecord{
		UserID:    userID,
		RequestID: requestID,
	}).First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *gormStore) UpdateGenerationRequest(record *GenerationRequestRecord) error {
	if record == nil {
		return nil
	}
	record.UpdatedAt = time.Now().UTC()
	return s.db.Save(record).Error
}
