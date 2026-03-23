import dotenv from 'dotenv';
import { configSchema, type AppConfig } from './schema.js';

dotenv.config();

/** Treat empty strings as undefined so .env files with KEY= work correctly. */
function env(key: string): string | undefined {
  const val = process.env[key];
  return val === '' || val === undefined ? undefined : val;
}

export function loadConfig(): AppConfig {
  const raw = {
    nodeEnv: env('NODE_ENV'),
    port: env('PORT'),
    logLevel: env('LOG_LEVEL'),
    databaseUrl: env('DATABASE_URL'),
    solanaRpcHttpUrl: env('SOLANA_RPC_HTTP_URL'),
    solanaRpcWsUrl: env('SOLANA_RPC_WS_URL'),
    solanaProgramId: env('SOLANA_PROGRAM_ID'),
    idlSourceType: env('IDL_SOURCE_TYPE'),
    idlFilePath: env('IDL_FILE_PATH'),
    idlAccountAddress: env('IDL_ACCOUNT_ADDRESS'),
    indexerMode: env('INDEXER_MODE'),
    batchStartSlot: env('BATCH_START_SLOT'),
    batchEndSlot: env('BATCH_END_SLOT'),
    batchSignatures: env('BATCH_SIGNATURES'),
    batchSize: env('BATCH_SIZE'),
    realtimeConfirmation: env('REALTIME_CONFIRMATION'),
    backfillEnabled: env('BACKFILL_ENABLED'),
    rpcMaxRetries: env('RPC_MAX_RETRIES'),
    rpcInitialBackoffMs: env('RPC_INITIAL_BACKOFF_MS'),
    rpcMaxBackoffMs: env('RPC_MAX_BACKOFF_MS'),
    checkpointCommitInterval: env('CHECKPOINT_COMMIT_INTERVAL'),
    pageSizeDefault: env('PAGE_SIZE_DEFAULT'),
    pageSizeMax: env('PAGE_SIZE_MAX'),
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/** Returns a sanitized config summary safe for logging (no secrets). */
export function configSummary(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    logLevel: config.logLevel,
    databaseUrl: config.databaseUrl.replace(/\/\/.*@/, '//***:***@'),
    solanaRpcHttpUrl: config.solanaRpcHttpUrl,
    solanaProgramId: config.solanaProgramId,
    idlSourceType: config.idlSourceType,
    indexerMode: config.indexerMode,
    batchSize: config.batchSize,
    rpcMaxRetries: config.rpcMaxRetries,
  };
}
