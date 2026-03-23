import dotenv from 'dotenv';
import { configSchema, type AppConfig } from './schema.js';

dotenv.config();

export function loadConfig(): AppConfig {
  const raw = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,
    databaseUrl: process.env.DATABASE_URL,
    solanaRpcHttpUrl: process.env.SOLANA_RPC_HTTP_URL,
    solanaRpcWsUrl: process.env.SOLANA_RPC_WS_URL,
    solanaProgramId: process.env.SOLANA_PROGRAM_ID,
    idlSourceType: process.env.IDL_SOURCE_TYPE,
    idlFilePath: process.env.IDL_FILE_PATH,
    idlAccountAddress: process.env.IDL_ACCOUNT_ADDRESS,
    indexerMode: process.env.INDEXER_MODE,
    batchStartSlot: process.env.BATCH_START_SLOT || undefined,
    batchEndSlot: process.env.BATCH_END_SLOT || undefined,
    batchSignatures: process.env.BATCH_SIGNATURES || undefined,
    batchSize: process.env.BATCH_SIZE,
    realtimeConfirmation: process.env.REALTIME_CONFIRMATION,
    backfillEnabled: process.env.BACKFILL_ENABLED,
    rpcMaxRetries: process.env.RPC_MAX_RETRIES,
    rpcInitialBackoffMs: process.env.RPC_INITIAL_BACKOFF_MS,
    rpcMaxBackoffMs: process.env.RPC_MAX_BACKOFF_MS,
    checkpointCommitInterval: process.env.CHECKPOINT_COMMIT_INTERVAL,
    pageSizeDefault: process.env.PAGE_SIZE_DEFAULT,
    pageSizeMax: process.env.PAGE_SIZE_MAX,
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
