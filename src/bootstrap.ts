import { loadConfig, type AppConfig } from './config/index.js';
import { configSummary } from './config/config.js';
import { createLogger, type Logger } from './logger/index.js';
import { createPool, type DbPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { loadIdl, type NormalizedIdl } from './idl/index.js';
import { SchemaGenerator } from './schema/index.js';
import { SolanaClient } from './solana/index.js';
import { InstructionDecoder } from './decoder/instruction-decoder.js';
import { AccountDecoder } from './decoder/account-decoder.js';
import { BatchIndexer } from './indexer/batch/index.js';
import { RealtimeIndexer } from './indexer/realtime/index.js';
import { GracefulShutdown } from './shutdown/index.js';
import { createApi } from './api/index.js';
import {
  ProgramRepository,
  TransactionRepository,
  InstructionEventRepository,
  AccountSnapshotRepository,
  CheckpointRepository,
  SchemaMetadataRepository,
  DecodingErrorRepository,
  IndexerRunRepository,
} from './db/repositories/index.js';

export async function bootstrap(): Promise<void> {
  // 1. Load and validate configuration
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info('Universal Solana Indexer starting...');
  logger.info(configSummary(config), 'Configuration loaded');

  // 2. Setup graceful shutdown
  const shutdown = new GracefulShutdown(logger);

  // 3. Database setup
  logger.info('Running database migrations...');
  await runMigrations(config.databaseUrl, logger);

  const pool = createPool(config.databaseUrl, logger);
  shutdown.register('database', async () => {
    await pool.end();
    logger.info('Database pool closed');
  });

  // Verify connection
  await pool.query('SELECT 1');
  logger.info('Database connection verified');

  // 4. Load and normalize IDL
  const idl = await loadIdl(config, logger);

  // 5. Generate schema metadata
  const programRepo = new ProgramRepository(pool);
  const schemaMetaRepo = new SchemaMetadataRepository(pool);
  const schemaGenerator = new SchemaGenerator(programRepo, schemaMetaRepo, logger);
  await schemaGenerator.generate(config.solanaProgramId, idl);

  // 6. Initialize Solana client
  const solanaClient = new SolanaClient({
    httpUrl: config.solanaRpcHttpUrl,
    wsUrl: config.solanaRpcWsUrl,
    retryOptions: {
      maxRetries: config.rpcMaxRetries,
      initialBackoffMs: config.rpcInitialBackoffMs,
      maxBackoffMs: config.rpcMaxBackoffMs,
      logger,
    },
    logger,
  });

  // 7. Initialize decoders
  const instructionDecoder = new InstructionDecoder(idl, config.solanaProgramId, logger);
  const accountDecoder = new AccountDecoder(idl, config.solanaProgramId, solanaClient, logger);

  // 8. Initialize repositories
  const transactionRepo = new TransactionRepository(pool);
  const instructionEventRepo = new InstructionEventRepository(pool);
  const accountSnapshotRepo = new AccountSnapshotRepository(pool);
  const checkpointRepo = new CheckpointRepository(pool);
  const decodingErrorRepo = new DecodingErrorRepository(pool);
  const indexerRunRepo = new IndexerRunRepository(pool);

  // 9. Start API server
  const api = await createApi({ config, pool, logger });
  shutdown.register('api', async () => {
    await api.close();
    logger.info('API server closed');
  });

  await api.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'API server listening');

  // 10. Start indexer
  const indexerDeps = {
    config,
    solanaClient,
    instructionDecoder,
    accountDecoder,
    transactionRepo,
    instructionEventRepo,
    accountSnapshotRepo,
    checkpointRepo,
    decodingErrorRepo,
    indexerRunRepo,
    pool,
    logger,
    shutdown,
  };

  if (config.indexerMode === 'batch') {
    const batchIndexer = new BatchIndexer(indexerDeps);
    await batchIndexer.run();
    logger.info('Batch indexing finished. API remains running. Press Ctrl+C to stop.');

    // Keep API running after batch completes
    await new Promise<void>((resolve) => {
      const check = () => {
        if (shutdown.isShuttingDown) resolve();
        else setTimeout(check, 1000);
      };
      check();
    });
  } else {
    const realtimeIndexer = new RealtimeIndexer(indexerDeps);
    await realtimeIndexer.run();
  }

  logger.info('Indexer stopped');
}
