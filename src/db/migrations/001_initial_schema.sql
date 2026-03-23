-- Core infrastructure tables for the universal Solana indexer.
-- Dynamic/IDL-specific data is stored in JSONB columns, keeping the schema universal.

-- Tracked programs
CREATE TABLE IF NOT EXISTS programs (
  id SERIAL PRIMARY KEY,
  program_id TEXT NOT NULL UNIQUE,
  idl_hash TEXT NOT NULL,
  idl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexer run tracking
CREATE TABLE IF NOT EXISTS indexer_runs (
  id SERIAL PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(program_id),
  mode TEXT NOT NULL CHECK (mode IN ('batch', 'realtime')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
  start_slot BIGINT,
  end_slot BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- Checkpoint for resume capability
CREATE TABLE IF NOT EXISTS checkpoints (
  id SERIAL PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(program_id),
  last_slot BIGINT NOT NULL,
  last_signature TEXT,
  last_block_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id)
);

-- Indexed transactions
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  success BOOLEAN NOT NULL,
  fee BIGINT,
  signers TEXT[] NOT NULL DEFAULT '{}',
  program_id TEXT NOT NULL,
  raw_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
CREATE INDEX IF NOT EXISTS idx_transactions_block_time ON transactions(block_time);
CREATE INDEX IF NOT EXISTS idx_transactions_program_id ON transactions(program_id);
CREATE INDEX IF NOT EXISTS idx_transactions_signers ON transactions USING GIN(signers);
CREATE INDEX IF NOT EXISTS idx_transactions_success ON transactions(success);

-- Decoded instruction events
CREATE TABLE IF NOT EXISTS instruction_events (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  program_id TEXT NOT NULL,
  instruction_name TEXT NOT NULL,
  instruction_index INT NOT NULL DEFAULT 0,
  is_inner_instruction BOOLEAN NOT NULL DEFAULT FALSE,
  accounts JSONB NOT NULL DEFAULT '[]',
  decoded_args JSONB NOT NULL DEFAULT '{}',
  raw_data TEXT,
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instruction_events_signature ON instruction_events(signature);
CREATE INDEX IF NOT EXISTS idx_instruction_events_instruction_name ON instruction_events(instruction_name);
CREATE INDEX IF NOT EXISTS idx_instruction_events_slot ON instruction_events(slot);
CREATE INDEX IF NOT EXISTS idx_instruction_events_block_time ON instruction_events(block_time);
CREATE INDEX IF NOT EXISTS idx_instruction_events_program_id ON instruction_events(program_id);

-- Account state snapshots
CREATE TABLE IF NOT EXISTS account_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_address TEXT NOT NULL,
  program_id TEXT NOT NULL,
  account_type TEXT NOT NULL,
  slot BIGINT NOT NULL,
  decoded_data JSONB NOT NULL DEFAULT '{}',
  data_hash TEXT,
  block_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_address, slot)
);

CREATE INDEX IF NOT EXISTS idx_account_snapshots_address ON account_snapshots(account_address);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_type ON account_snapshots(account_type);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_slot ON account_snapshots(slot);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_program_id ON account_snapshots(program_id);

-- IDL-driven schema metadata (describes what instructions and accounts exist)
CREATE TABLE IF NOT EXISTS schema_metadata (
  id SERIAL PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(program_id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('instruction', 'account')),
  entity_name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]',
  discriminator TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, entity_type, entity_name)
);

CREATE INDEX IF NOT EXISTS idx_schema_metadata_program ON schema_metadata(program_id);
CREATE INDEX IF NOT EXISTS idx_schema_metadata_type ON schema_metadata(entity_type);

-- Decoding errors for diagnostics
CREATE TABLE IF NOT EXISTS decoding_errors (
  id BIGSERIAL PRIMARY KEY,
  signature TEXT,
  program_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  slot BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decoding_errors_program ON decoding_errors(program_id);
CREATE INDEX IF NOT EXISTS idx_decoding_errors_slot ON decoding_errors(slot);
