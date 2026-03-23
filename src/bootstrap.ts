import { loadConfig } from './config/index.js';
import { createLogger } from './logger/index.js';

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info('Universal Solana Indexer starting...');
  logger.info({ mode: config.indexerMode, program: config.solanaProgramId }, 'Configuration loaded');
}
