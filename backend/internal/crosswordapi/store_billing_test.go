package crosswordapi

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestBillingCustomerLinkStoreMethods(t *testing.T) {
	s := testStore(t)

	if err := s.UpsertBillingCustomerLink(nil); err != nil {
		t.Fatalf("UpsertBillingCustomerLink(nil) error = %v", err)
	}

	link := &BillingCustomerLink{
		UserID:           "user-1",
		Provider:         billingProviderPaddle,
		PaddleCustomerID: "ctm_1",
		Email:            "first@example.com",
	}
	if err := s.UpsertBillingCustomerLink(link); err != nil {
		t.Fatalf("UpsertBillingCustomerLink(create) error = %v", err)
	}
	if link.ID == "" {
		t.Fatal("expected billing customer link id to be assigned")
	}

	storedLink, err := s.GetBillingCustomerLink("user-1", billingProviderPaddle)
	if err != nil {
		t.Fatalf("GetBillingCustomerLink() error = %v", err)
	}
	if storedLink.PaddleCustomerID != "ctm_1" || storedLink.Email != "first@example.com" {
		t.Fatalf("unexpected stored link: %#v", storedLink)
	}

	updatedLink := &BillingCustomerLink{
		UserID:           "user-1",
		Provider:         billingProviderPaddle,
		PaddleCustomerID: "ctm_2",
		Email:            "updated@example.com",
	}
	if err := s.UpsertBillingCustomerLink(updatedLink); err != nil {
		t.Fatalf("UpsertBillingCustomerLink(update) error = %v", err)
	}

	byUser, err := s.GetBillingCustomerLink("user-1", billingProviderPaddle)
	if err != nil {
		t.Fatalf("GetBillingCustomerLink(updated) error = %v", err)
	}
	if byUser.PaddleCustomerID != "ctm_2" || byUser.Email != "updated@example.com" {
		t.Fatalf("unexpected updated link: %#v", byUser)
	}

	byCustomerID, err := s.GetBillingCustomerLinkByPaddleCustomerID(billingProviderPaddle, "ctm_2")
	if err != nil {
		t.Fatalf("GetBillingCustomerLinkByPaddleCustomerID() error = %v", err)
	}
	if byCustomerID.UserID != "user-1" {
		t.Fatalf("unexpected customer-id lookup result: %#v", byCustomerID)
	}

	_, err = s.GetBillingCustomerLink("missing-user", billingProviderPaddle)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected record not found for missing user, got %v", err)
	}
	_, err = s.GetBillingCustomerLinkByPaddleCustomerID(billingProviderPaddle, "missing-customer")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected record not found for missing paddle customer id, got %v", err)
	}
}

func TestBillingEventStoreMethods(t *testing.T) {
	s := testStore(t)

	if err := s.CreateBillingEventRecord(nil); err != nil {
		t.Fatalf("CreateBillingEventRecord(nil) error = %v", err)
	}

	now := time.Date(2026, time.March, 29, 10, 0, 0, 0, time.UTC)
	recordOne := &BillingEventRecord{
		Provider:      billingProviderPaddle,
		EventID:       "evt_1",
		EventType:     paddleEventTypeTransactionCreated,
		UserID:        "user-1",
		TransactionID: "txn_1",
		OccurredAt:    now.Add(-2 * time.Hour),
	}
	recordTwo := &BillingEventRecord{
		Provider:      billingProviderPaddle,
		EventID:       "evt_2",
		EventType:     paddleEventTypeTransactionUpdated,
		UserID:        "user-1",
		TransactionID: "txn_1",
		OccurredAt:    now.Add(-1 * time.Hour),
	}
	recordThree := &BillingEventRecord{
		Provider:      billingProviderPaddle,
		EventID:       "evt_3",
		EventType:     paddleEventTypeTransactionCompleted,
		UserID:        "user-1",
		TransactionID: "txn_2",
		OccurredAt:    now,
	}

	for _, record := range []*BillingEventRecord{recordOne, recordTwo, recordThree} {
		if err := s.CreateBillingEventRecord(record); err != nil {
			t.Fatalf("CreateBillingEventRecord(%s) error = %v", record.EventID, err)
		}
		if record.ID == "" {
			t.Fatalf("expected record %s to receive an id", record.EventID)
		}
	}

	records, err := s.ListBillingEventRecords("user-1", billingProviderPaddle, 0)
	if err != nil {
		t.Fatalf("ListBillingEventRecords(default limit) error = %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("expected 3 billing records, got %d", len(records))
	}
	if records[0].EventID != "evt_3" || records[1].EventID != "evt_2" || records[2].EventID != "evt_1" {
		t.Fatalf("unexpected record order: %#v", records)
	}

	limitedRecords, err := s.ListBillingEventRecords("user-1", billingProviderPaddle, 2)
	if err != nil {
		t.Fatalf("ListBillingEventRecords(limit=2) error = %v", err)
	}
	if len(limitedRecords) != 2 {
		t.Fatalf("expected limited billing records, got %d", len(limitedRecords))
	}

}

func TestBillingEventStoreMethods_IncludesLinkedCustomerEventsWithoutUserID(t *testing.T) {
	s := testStore(t)

	if err := s.UpsertBillingCustomerLink(&BillingCustomerLink{
		UserID:           "user-1",
		Provider:         billingProviderPaddle,
		PaddleCustomerID: "ctm_linked",
		Email:            "user@example.com",
	}); err != nil {
		t.Fatalf("UpsertBillingCustomerLink(linked) error = %v", err)
	}

	now := time.Date(2026, time.March, 29, 12, 0, 0, 0, time.UTC)
	for _, record := range []*BillingEventRecord{
		{
			Provider:         billingProviderPaddle,
			EventID:          "evt_direct",
			EventType:        paddleEventTypeTransactionCompleted,
			UserID:           "user-1",
			PaddleCustomerID: "ctm_linked",
			TransactionID:    "txn_direct",
			OccurredAt:       now.Add(-1 * time.Hour),
		},
		{
			Provider:         billingProviderPaddle,
			EventID:          "evt_orphan_linked",
			EventType:        paddleEventTypeTransactionCompleted,
			PaddleCustomerID: "ctm_linked",
			TransactionID:    "txn_orphan_linked",
			OccurredAt:       now,
		},
		{
			Provider:         billingProviderPaddle,
			EventID:          "evt_orphan_other",
			EventType:        paddleEventTypeTransactionCompleted,
			PaddleCustomerID: "ctm_other",
			TransactionID:    "txn_orphan_other",
			OccurredAt:       now.Add(1 * time.Hour),
		},
	} {
		if err := s.CreateBillingEventRecord(record); err != nil {
			t.Fatalf("CreateBillingEventRecord(%s) error = %v", record.EventID, err)
		}
	}

	records, err := s.ListBillingEventRecords("user-1", billingProviderPaddle, 0)
	if err != nil {
		t.Fatalf("ListBillingEventRecords(linked customer) error = %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected direct + linked orphan records, got %#v", records)
	}
	if records[0].EventID != "evt_orphan_linked" || records[1].EventID != "evt_direct" {
		t.Fatalf("unexpected linked-customer billing record order: %#v", records)
	}
}

func TestBillingEventStoreMethods_HasBillingCreditedTransaction(t *testing.T) {
	s := testStore(t)

	for _, record := range []*BillingEventRecord{
		{
			Provider:      billingProviderPaddle,
			EventID:       "evt_pending",
			EventType:     paddleEventTypeTransactionUpdated,
			UserID:        "user-1",
			TransactionID: "txn_pending",
			CreditsDelta:  0,
			OccurredAt:    time.Date(2026, time.March, 29, 10, 0, 0, 0, time.UTC),
		},
		{
			Provider:      billingProviderPaddle,
			EventID:       "evt_credited",
			EventType:     paddleEventTypeTransactionCompleted,
			UserID:        "user-1",
			TransactionID: "txn_paid",
			CreditsDelta:  20,
			OccurredAt:    time.Date(2026, time.March, 29, 11, 0, 0, 0, time.UTC),
		},
	} {
		if err := s.CreateBillingEventRecord(record); err != nil {
			t.Fatalf("CreateBillingEventRecord(%s) error = %v", record.EventID, err)
		}
	}

	hasPending, err := s.HasBillingCreditedTransaction(billingProviderPaddle, "txn_pending")
	if err != nil {
		t.Fatalf("HasBillingCreditedTransaction(txn_pending) error = %v", err)
	}
	if hasPending {
		t.Fatal("expected pending transaction to report no credited record")
	}

	hasPaid, err := s.HasBillingCreditedTransaction(billingProviderPaddle, "txn_paid")
	if err != nil {
		t.Fatalf("HasBillingCreditedTransaction(txn_paid) error = %v", err)
	}
	if !hasPaid {
		t.Fatal("expected paid transaction to report credited record")
	}
}
