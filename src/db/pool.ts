import pg from 'pg';
import type { Logger } from '../logger/index.js';

const { Pool } = pg;

export type DbPool = pg.Pool;

export function createPool(databaseUrl: string, logger: Logger): DbPool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected pool error');
  });

  pool.on('connect', () => {
    logger.debug('New database connection established');
  });

  return pool;
}
