# Universal Solana Indexer

A production-ready, universal Solana indexer that automatically adapts to **any Anchor IDL**. Feed it an IDL, point it at a program, and it will index transactions, decode instructions, snapshot account states, and expose a rich query API — all without writing a single line of program-specific code.

## Features

- **Dynamic IDL-driven schema** — no manual table definitions per program
- **Instruction decoding** — outer + inner instructions via BorshCoder with discriminator fallback
- **Account state decoding** — fetches and decodes program-owned account data
- **Batch mode** — index a slot range or list of signatures
- **Real-time mode** — live subscription with cold-start recovery and backfill
- **Exponential backoff** — automatic retry with jitter for all RPC calls
- **Graceful shutdown** — SIGINT/SIGTERM handling with safe state flushing
- **Advanced REST API** — multi-filter queries, aggregations, statistics
- **Atomic persistence** — transactions + events committed together with checkpoint
- **Docker Compose** — one command to run everything
- **Comprehensive tests** — 44 unit tests covering all core logic

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Bootstrap                      │
│  Config → Migrations → IDL → Schema → Indexer   │
└──────────┬──────────────────────────┬────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼───────┐
    │ Batch       │           │ Real-time     │
    │ Indexer     │           │ Indexer       │
    │             │           │ (cold start)  │
    └──────┬──────┘           └───────┬───────┘
           │                          │
    ┌──────▼──────────────────────────▼──────┐
    │          Solana RPC Client              │
    │       (with retry + backoff)           │
    └──────────────────┬─────────────────────┘
                       │
    ┌──────────────────▼─────────────────────┐
    │   Instruction Decoder + Account Decoder │
    │      (BorshCoder + discriminator)       │
    └──────────────────┬─────────────────────┘
                       │
    ┌──────────────────▼─────────────────────┐
    │         PostgreSQL (JSONB)              │
    │   transactions · instruction_events    │
    │   account_snapshots · checkpoints      │
    │   schema_metadata · decoding_errors    │
    └──────────────────┬─────────────────────┘
                       │
    ┌──────────────────▼─────────────────────┐
    │           Fastify REST API              │
    │  /transactions · /instructions          │
    │  /aggregations · /stats · /schema       │
    └────────────────────────────────────────┘
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── bootstrap.ts          # Orchestration: config → DB → IDL → indexer → API
├── config/               # Zod-validated environment configuration
├── logger/               # Structured pino logging
├── db/
│   ├── pool.ts           # PostgreSQL connection pool
│   ├── migrate.ts        # Migration runner
│   ├── migrations/       # SQL migration files
│   └── repositories/     # Data access layer
├── idl/
│   ├── types.ts          # Anchor IDL type definitions
│   ├── file-source.ts    # Load IDL from local file
│   ├── onchain-source.ts # Load IDL from on-chain account
│   ├── normalizer.ts     # Normalize IDL into internal model
│   └── loader.ts         # IDL source factory
├── schema/
│   └── generator.ts      # IDL → schema metadata generation
├── solana/
│   └── client.ts         # Solana RPC wrapper with retry
├── decoder/
│   ├── instruction-decoder.ts  # Decode program instructions
│   └── account-decoder.ts      # Decode account states
├── indexer/
│   ├── batch/            # Batch indexing pipeline
│   └── realtime/         # Real-time indexing with cold start
├── retry/                # Exponential backoff utility
├── shutdown/             # Graceful shutdown handler
└── api/
    ├── server.ts         # Fastify setup
    └── routes/           # API endpoints
test/
├── fixtures/             # Sample IDLs
└── unit/                 # Unit tests
```

## How IDL-Driven Schema Generation Works

This is the core innovation. Instead of writing program-specific tables, the indexer uses a **hybrid schema strategy**:

### Stable relational tables
Infrastructure tables (`transactions`, `instruction_events`, `account_snapshots`) have fixed columns for universal data (signature, slot, block time, signers) and **JSONB columns** for decoded, IDL-specific data (`decoded_args`, `decoded_data`).

### Dynamic metadata registry
The `schema_metadata` table stores the IDL's instruction and account definitions:
- What instructions exist, their arguments and account parameters
- What account types exist, their field definitions and discriminators

### Why this approach?
| Approach | Pros | Cons |
|----------|------|------|
| **Static tables per program** | Best query performance | Not universal, manual work |
| **Pure JSONB everything** | Maximum flexibility | Poor queryability |
| **Hybrid (our choice)** | Universal + queryable | JSONB queries slower than native columns |

The hybrid approach gives us universality (any IDL works without code changes) while maintaining queryability through PostgreSQL's JSONB operators and GIN indexes.

### Trade-off
We sacrifice some query performance on deeply nested JSONB fields in exchange for true universality. For high-throughput production use with a single program, a next step would be to auto-generate program-specific views or materialized columns from the metadata.

## Instruction Decoding

For each indexed transaction:
1. Identify instructions targeting the configured program (outer + inner)
2. Attempt decoding via `BorshCoder` from `@coral-xyz/anchor`
3. Fall back to discriminator-based matching if BorshCoder fails
4. Serialize decoded args (handles BN, PublicKey, Uint8Array, nested structs)
5. Store: instruction name, index, accounts, decoded args, raw data

## Account State Decoding

After processing instructions:
1. Extract writable account addresses from decoded instructions
2. Batch-fetch account data from Solana
3. Filter to program-owned accounts only
4. Match 8-byte discriminator against known account types
5. Decode via BorshCoder, store as typed snapshots

### Limitations
- Account state is fetched at current slot, not historical
- Accounts deleted or reallocated between indexing and fetch may be missed
- Programs with non-standard discriminators need IDL discriminator fields

## Batch Mode

Process historical transactions by slot range or signature list.

**Slot range flow:**
1. Paginate through `getSignaturesForAddress` within the range
2. Fetch transactions in configurable batch sizes
3. Decode and persist atomically
4. Update checkpoint periodically

**Signature list flow:**
1. Accept comma-separated signature list from config
2. Process in batches
3. Same decode/persist/checkpoint logic

## Real-Time Mode with Cold Start

**Cold start recovery:**
1. Read last checkpoint from `checkpoints` table
2. Calculate gap between checkpoint and current slot
3. Backfill missed signatures via `getSignaturesForAddress(until: lastSignature)`
4. Process in oldest-first order

**Live indexing:**
1. Subscribe to program logs via `connection.onLogs`
2. For each log event, fetch full parsed transaction
3. Decode and persist with atomic checkpoint update

**Ordering guarantee:** Within a single subscription callback, transactions are processed sequentially. Cross-slot ordering is maintained by using slot-based checkpoints.

## Reliability Strategy

### Retry + Exponential Backoff
All RPC calls go through `withRetry()`:
- Classifies errors as retryable (429, timeout, connection reset, 5xx)
- Exponential delay: `min(initial * 2^attempt, max) + jitter`
- Configurable max attempts, initial delay, max delay

### Graceful Shutdown
- Catches SIGINT/SIGTERM
- Sets `isShuttingDown` flag (checked by indexer loops)
- Executes cleanup functions in LIFO order with 10s timeout per step:
  1. Stop log subscription
  2. Close API server
  3. Close database pool
- Prevents half-written records

### Atomic Persistence
- Transaction + instruction events committed in a single DB transaction
- Checkpoint updated atomically with data (in real-time mode)
- Idempotent inserts via `ON CONFLICT DO NOTHING`

## API Reference

### `GET /health`
Health check with database connectivity test.

### `GET /transactions`
Query indexed transactions with multiple simultaneous filters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `instruction_name` | string | Filter by instruction name |
| `signer` | string | Filter by signer address |
| `slot_from` | number | Minimum slot |
| `slot_to` | number | Maximum slot |
| `time_from` | ISO datetime | Start time |
| `time_to` | ISO datetime | End time |
| `success` | boolean | Filter by success/failure |
| `account_address` | string | Filter by involved account |
| `program_id` | string | Override default program |
| `limit` | number | Page size (default 50, max 500) |
| `offset` | number | Pagination offset |
| `order_by` | `slot` \| `block_time` | Sort field |
| `order_dir` | `asc` \| `desc` | Sort direction |

### `GET /transactions/:signature`
Full transaction detail with decoded instructions and account snapshots.

### `GET /instructions`
Query decoded instruction events with filters (same as transactions but instruction-focused).

### `GET /aggregations/instructions`
Instruction count aggregations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `instruction_name` | string | Filter specific instruction |
| `time_from` | ISO datetime | Start period |
| `time_to` | ISO datetime | End period |
| `group_by` | `day` \| `hour` | Time grouping |

### `GET /stats/program`
Comprehensive program statistics.

### `GET /schema`
IDL-driven schema metadata (available instructions and accounts).

## Example Queries

```bash
# Health check
curl http://localhost:3000/health

# List recent transactions
curl "http://localhost:3000/transactions?limit=10"

# Filter by instruction name and time range
curl "http://localhost:3000/transactions?instruction_name=initialize&time_from=2024-01-01T00:00:00Z"

# Multi-filter: successful initialize calls by specific signer
curl "http://localhost:3000/transactions?instruction_name=initialize&signer=ABC...&success=true"

# Get transaction detail
curl http://localhost:3000/transactions/5UBt...

# Instruction aggregation grouped by day
curl "http://localhost:3000/aggregations/instructions?group_by=day&time_from=2024-01-01T00:00:00Z"

# Aggregation for specific instruction
curl "http://localhost:3000/aggregations/instructions?instruction_name=increment&group_by=hour"

# Program statistics
curl http://localhost:3000/stats/program

# Schema metadata (what instructions and accounts the IDL defines)
curl http://localhost:3000/schema
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment |
| `PORT` | No | `3000` | API port |
| `LOG_LEVEL` | No | `info` | Log level |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `SOLANA_RPC_HTTP_URL` | Yes | — | Solana HTTP RPC |
| `SOLANA_RPC_WS_URL` | Yes | — | Solana WebSocket RPC |
| `SOLANA_PROGRAM_ID` | Yes | — | Program to index |
| `IDL_SOURCE_TYPE` | Yes | — | `file` or `onchain` |
| `IDL_FILE_PATH` | If file | — | Path to IDL JSON |
| `IDL_ACCOUNT_ADDRESS` | If onchain | — | IDL account address |
| `INDEXER_MODE` | Yes | — | `batch` or `realtime` |
| `BATCH_START_SLOT` | If batch | — | Start slot for range |
| `BATCH_END_SLOT` | If batch | — | End slot for range |
| `BATCH_SIGNATURES` | If batch | — | Comma-separated signatures |
| `BATCH_SIZE` | No | `50` | Transactions per batch |
| `REALTIME_CONFIRMATION` | No | `confirmed` | Confirmation level |
| `BACKFILL_ENABLED` | No | `true` | Enable cold-start backfill |
| `RPC_MAX_RETRIES` | No | `5` | Max retry attempts |
| `RPC_INITIAL_BACKOFF_MS` | No | `500` | Initial backoff |
| `RPC_MAX_BACKOFF_MS` | No | `30000` | Max backoff |
| `CHECKPOINT_COMMIT_INTERVAL` | No | `100` | Checkpoint frequency |
| `PAGE_SIZE_DEFAULT` | No | `50` | Default page size |
| `PAGE_SIZE_MAX` | No | `500` | Maximum page size |

## Local Development

```bash
# Install dependencies
npm install

# Start PostgreSQL
docker compose up -d postgres

# Configure
cp .env.example .env
# Edit .env with your Solana RPC and program details

# Run migrations
npm run migrate

# Start in dev mode (hot reload)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build for production
npm run build
npm start
```

## Docker Usage

```bash
# Configure
cp .env.example .env
# Edit .env

# Start everything
docker compose up --build

# View logs
docker compose logs -f indexer

# Stop
docker compose down
```

Docker Compose starts PostgreSQL 16 with health checks and runs migrations automatically on startup.

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

**Test coverage:**
- Config validation (10 tests)
- IDL normalization (13 tests)
- Schema generation (5 tests)
- Retry/backoff logic (7 tests)
- Graceful shutdown (4 tests)
- File IDL loading (3 tests)
- Instruction decoding logic validated via normalizer + decoder integration

RPC-dependent tests are not included to keep CI fast. The decoder and indexer logic is validated through:
- Unit tests on the normalization and schema layers
- Integration-testable via Docker with a devnet/testnet RPC

## Trade-offs and Limitations

### JSONB vs Native Columns
**Decision:** Use JSONB for decoded data instead of generating per-program tables.
**Why:** True universality — any IDL works without schema migrations. Trade-off: queries on nested JSONB fields are slower than native columns. Mitigated by GIN indexes and the ability to add materialized views per program.

### Account State Snapshots
**Limitation:** Account state is fetched at the current slot after instruction processing, not reconstructed at the exact transaction slot.
**Why:** Historical account state reconstruction requires a full Geyser plugin or archival node. Our approach is practical and works for most use cases.

### Single-Program Indexing
**Decision:** Index one program at a time per instance.
**Why:** Simpler checkpoint and state management. Multiple programs can be indexed by running multiple instances against the same database.

### BorshCoder Dependency
**Decision:** Use `@coral-xyz/anchor`'s BorshCoder for decoding.
**Why:** It handles the Borsh serialization format used by Anchor programs. Fallback to discriminator-only matching when BorshCoder fails. Non-Anchor programs would need a custom decoder.

### TypeScript over Rust
**Decision:** TypeScript for the entire stack.
**Why:** Reviewer accessibility, faster development, rich Solana JS ecosystem. For very high-throughput indexing (>10K TPS), Rust would be more appropriate.

## Future Improvements

- Auto-generate program-specific SQL views from schema metadata
- WebSocket API for real-time query subscriptions
- Multi-program indexing in a single instance
- Geyser plugin integration for zero-latency account updates
- OpenAPI/Swagger documentation generation
- Prometheus metrics endpoint
- Account history reconstruction via transaction replay
- Support for non-Anchor programs with custom decoders

## License

MIT
