# Ledger Integration Guide

## Overview

Ledger is a double-entry credit accounting system with append-only immutable entries, reservation holds, idempotency, and batch operations. Available as a gRPC microservice or embedded Go library.

**Module:** `github.com/MarkoPoloResearchLab/ledger`
**Go Version:** 1.25+

## Dependencies

| Dependency | Purpose |
|---|---|
| `gorm.io/gorm` | ORM framework |
| `gorm.io/driver/postgres` | PostgreSQL driver (production) |
| `github.com/glebarez/sqlite` | SQLite driver (default/testing) |
| `google.golang.org/grpc` | gRPC framework |
| `google.golang.org/protobuf` | Protobuf serialization |
| `go.uber.org/zap` | Structured logging |
| `github.com/spf13/cobra` / `viper` | CLI config management |

## Deployment Options

### Option A: gRPC Microservice (Standalone)

```bash
DATABASE_URL=postgres://localhost/credit \
GRPC_LISTEN_ADDR=:50051 \
go run ./cmd/credit
```

**Environment Variables:**

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///tmp/ledger.db` | `sqlite://` or `postgres://` DSN |
| `GRPC_LISTEN_ADDR` | `:50051` | gRPC listen address |

**Note:** The service does NOT enforce auth. Deploy on a private/internal network and front with an HTTP gateway that validates sessions.

### Option B: Embedded Go Library

```go
import (
    "github.com/MarkoPoloResearchLab/ledger/pkg/ledger"
    "github.com/MarkoPoloResearchLab/ledger/internal/store/gormstore"
)

store := gormstore.New(db)
service, err := ledger.NewService(store, time.Now().UTC().Unix)
```

## gRPC API

Service: `credit.v1.CreditService`

### Query Operations

| RPC | Returns |
|---|---|
| `GetBalance` | `{ total_cents, available_cents }` |
| `GetReservation` | Reservation state (active/captured/released/expired) |
| `ListReservations` | Paginated reservations with optional status filter |
| `ListEntries` | Paginated ledger entries (reverse-chronological) |

### Mutation Operations (all return `{ entry_id, created_unix_utc }`)

| RPC | Purpose |
|---|---|
| `Grant` | Add positive credit (optionally expiring) |
| `Spend` | Debit credit directly (no hold) |
| `Reserve` | Place hold on available balance |
| `Capture` | Finalize hold as debit |
| `Release` | Cancel hold, return funds to available |
| `Refund` | Create refund entry linked to prior debit |
| `Batch` | Execute multiple mutations atomically or best-effort |

## Go Service Interface

```go
// Queries
Balance(ctx, tenantID, userID, ledgerID) → Balance

// Mutations (return Entry)
GrantEntry(ctx, tenantID, userID, ledgerID, amount, idempotencyKey, expiresAtUnixUTC, metadata) → Entry
ReserveEntry(ctx, tenantID, userID, ledgerID, amount, reservationID, idempotencyKey, expiresAtUnixUTC, metadata) → Entry
CaptureEntry(ctx, tenantID, userID, ledgerID, reservationID, idempotencyKey, amount, metadata) → Entry
ReleaseEntry(ctx, tenantID, userID, ledgerID, reservationID, idempotencyKey, metadata) → Entry
SpendEntry(ctx, tenantID, userID, ledgerID, amount, idempotencyKey, metadata) → Entry
RefundByEntryID(ctx, tenantID, userID, ledgerID, originalEntryID, amount, idempotencyKey, metadata) → Entry
RefundByOriginalIdempotencyKey(ctx, ...) → Entry

// Batch
Batch(ctx, tenantID, userID, ledgerID, operations []BatchOperation, atomic bool) → []BatchOperationResult

// Lists
ListEntries(ctx, tenantID, userID, ledgerID, beforeUnixUTC, limit, filter) → []Entry
ListReservationStates(ctx, ...) → []Reservation
GetReservationState(ctx, tenantID, userID, ledgerID, reservationID) → Reservation
```

## Domain Types

### Identity Types (validated via constructors)

```go
NewTenantID(raw string) (TenantID, error)
NewUserID(raw string) (UserID, error)
NewLedgerID(raw string) (LedgerID, error)
NewReservationID(raw string) (ReservationID, error)
NewIdempotencyKey(raw string) (IdempotencyKey, error)
NewMetadataJSON(raw string) (MetadataJSON, error)
```

### Amount Types

- `PositiveAmountCents` — strictly positive (>0)
- `AmountCents` — non-negative (>=0)
- `SignedAmountCents` — any value (can be negative)
- `EntryAmountCents` — non-zero ledger delta

### Entry Types

- `grant` — positive credit added
- `hold` — balance reserved
- `reverse_hold` — reservation released
- `spend` — direct debit
- `refund` — refund of prior debit

## Store Interface

For custom DB implementations:

```go
type Store interface {
    WithTx(ctx, fn func(ctx, txStore Store) error) error
    GetOrCreateAccountID(ctx, tenantID, userID, ledgerID) (AccountID, error)
    InsertEntry(ctx, entryInput EntryInput) (Entry, error)
    GetEntry(ctx, accountID, entryID) (Entry, error)
    GetEntryByIdempotencyKey(ctx, accountID, idempotencyKey) (Entry, error)
    SumRefunds(ctx, accountID, originalEntryID) (AmountCents, error)
    SumTotal(ctx, accountID, atUnixUTC) (SignedAmountCents, error)
    SumActiveHolds(ctx, accountID, atUnixUTC) (AmountCents, error)
    CreateReservation(ctx, reservation) error
    GetReservation(ctx, accountID, reservationID) (Reservation, error)
    UpdateReservationStatus(ctx, accountID, reservationID, from, to) error
    ListReservations(ctx, accountID, beforeCreatedUnixUTC, limit, filter) ([]Reservation, error)
    ListEntries(ctx, accountID, beforeUnixUTC, limit, filter) ([]Entry, error)
}
```

Built-in: `gormstore.Store` — full GORM-backed implementation.

## Idempotency

- Every mutation requires a unique `idempotencyKey` per account
- Resubmitting same key returns `ErrDuplicateIdempotencyKey` (gRPC: `AlreadyExists`)
- Namespace keys for safe retries: `grant:<id>`, `spend:<id>`, `refund:<id>`

## Error Handling

```go
// Domain errors (via errors.Is)
ErrInsufficientFunds        // spend/reserve would overdraw
ErrDuplicateIdempotencyKey  // key already used
ErrReservationClosed        // reservation not active
ErrUnknownReservation       // reservation doesn't exist
ErrUnknownEntry             // entry not found
ErrRefundExceedsDebit       // refund > original debit

// Validation errors
ErrInvalidUserID, ErrInvalidTenantID, ErrInvalidLedgerID,
ErrInvalidReservationID, ErrInvalidIdempotencyKey, ErrInvalidAmountCents,
ErrInvalidMetadataJSON

// Structured error wrapping
if opErr, ok := err.(ledger.OperationError); ok {
    code := opErr.Code()           // "insufficient_funds", etc.
    op := opErr.Operation()        // "grant", "spend", etc.
    subject := opErr.Subject()     // "balance", "entry", "reservation"
}
```

## Batch Operations

- **Atomic** (`atomic=true`): all-or-nothing; failed operations rolled back
- **Best-effort** (`atomic=false`): each op runs independently with savepoints
- Max 5000 operations per batch

Supported ops: `BatchGrantOperation`, `BatchReserveOperation`, `BatchSpendOperation`, `BatchCaptureOperation`, `BatchReleaseOperation`, `BatchRefundOperation`

## Optional Operation Logger

```go
service, _ := ledger.NewService(store, now, ledger.WithOperationLogger(myLogger))
```

Implement `OperationLogger` interface for observability on every mutation.

## Usage Example

```go
ctx := context.Background()
tenantID, _ := ledger.NewTenantID("default")
userID, _ := ledger.NewUserID("user-123")
ledgerID, _ := ledger.NewLedgerID("default")
metadata, _ := ledger.NewMetadataJSON("{}")

// Grant credits
amount, _ := ledger.NewPositiveAmountCents(1000)
key, _ := ledger.NewIdempotencyKey("grant-1")
entry, _ := service.GrantEntry(ctx, tenantID, userID, ledgerID, amount, key, 0, metadata)

// Reserve for purchase
resID, _ := ledger.NewReservationID("order-555")
resKey, _ := ledger.NewIdempotencyKey("reserve-1")
service.ReserveEntry(ctx, tenantID, userID, ledgerID, 500, resID, resKey, 0, metadata)

// Capture (finalize purchase)
capKey, _ := ledger.NewIdempotencyKey("capture-1")
service.CaptureEntry(ctx, tenantID, userID, ledgerID, resID, capKey, 500, metadata)

// Check balance
balance, _ := service.Balance(ctx, tenantID, userID, ledgerID)
```

## Typical Integration Flow

1. Authenticate user session (via TAuth or similar)
2. Call `GetBalance` to show available credits
3. On purchase: `Reserve` → fulfill order → `Capture` (or `Release` to cancel)
4. For refunds: `Refund` with original entry or idempotency key
5. For high-volume: use `Batch` with `atomic=false`

## Database

GORM handles automatic schema migration on startup. Tables: `accounts`, `ledger_entries`, `reservations`.

- **SQLite**: `sqlite:///path/to/file.db` (default, file-based)
- **PostgreSQL 13+**: `postgres://user:pass@host:5432/db` (production recommended)

## Design Principles

1. **Append-only ledger** — no balance overwrites; all changes are immutable entries
2. **Account scoping** — `(tenant_id, user_id, ledger_id)` uniquely identify an account
3. **Amounts as cents** — int64, no floating-point errors
4. **Expiration support** — credits can expire; `expires_at_unix_utc=0` means permanent
5. **Holds/reservations** — two-phase commit pattern (Reserve → Capture/Release)
6. **Refund enforcement** — refunds can't exceed original debit
