package crosswordapi

import (
	"testing"
	"time"
)

func TestGenerationRequestStore_NilRecordNoOp(t *testing.T) {
	store := testStore(t).(*gormStore)

	if err := store.CreateGenerationRequest(nil); err != nil {
		t.Fatalf("CreateGenerationRequest(nil) error = %v", err)
	}
	if err := store.UpdateGenerationRequest(nil); err != nil {
		t.Fatalf("UpdateGenerationRequest(nil) error = %v", err)
	}

	var count int64
	if err := store.db.Model(&GenerationRequestRecord{}).Count(&count).Error; err != nil {
		t.Fatalf("Count(GenerationRequestRecord): %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no generation request rows, got %d", count)
	}
}

func TestGenerationRequestStore_CreateGetAndUpdateLifecycle(t *testing.T) {
	store := testStore(t).(*gormStore)
	record := &GenerationRequestRecord{
		UserID:    "user-1",
		RequestID: "req-1",
		Topic:     "cats",
		WordCount: 5,
		Status:    generationRequestStatusPending,
	}

	if err := store.CreateGenerationRequest(record); err != nil {
		t.Fatalf("CreateGenerationRequest: %v", err)
	}
	if record.ID == "" {
		t.Fatal("expected generated ID")
	}
	if record.CreatedAt.IsZero() {
		t.Fatal("expected CreatedAt to be set")
	}
	if record.UpdatedAt.IsZero() {
		t.Fatal("expected UpdatedAt to be set")
	}

	storedRecord, err := store.GetGenerationRequest("user-1", "req-1")
	if err != nil {
		t.Fatalf("GetGenerationRequest: %v", err)
	}
	if storedRecord.Topic != "cats" {
		t.Fatalf("expected topic cats, got %q", storedRecord.Topic)
	}
	if storedRecord.Status != generationRequestStatusPending {
		t.Fatalf("expected pending status, got %q", storedRecord.Status)
	}

	previousUpdatedAt := storedRecord.UpdatedAt
	time.Sleep(10 * time.Millisecond)

	storedRecord.Status = generationRequestStatusSucceeded
	storedRecord.PuzzleID = "puzzle-1"
	if err := store.UpdateGenerationRequest(storedRecord); err != nil {
		t.Fatalf("UpdateGenerationRequest: %v", err)
	}

	updatedRecord, err := store.GetGenerationRequest("user-1", "req-1")
	if err != nil {
		t.Fatalf("GetGenerationRequest(updated): %v", err)
	}
	if updatedRecord.Status != generationRequestStatusSucceeded {
		t.Fatalf("expected succeeded status, got %q", updatedRecord.Status)
	}
	if updatedRecord.PuzzleID != "puzzle-1" {
		t.Fatalf("expected puzzle id puzzle-1, got %q", updatedRecord.PuzzleID)
	}
	if !updatedRecord.UpdatedAt.After(previousUpdatedAt) {
		t.Fatalf("expected UpdatedAt to advance from %v to %v", previousUpdatedAt, updatedRecord.UpdatedAt)
	}
}
