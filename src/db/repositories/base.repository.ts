import type pg from 'pg';
import type { DbPool } from '../pool.js';

export type Queryable = DbPool | pg.PoolClient;

export abstract class BaseRepository {
  constructor(protected readonly pool: DbPool) {}

  /** Run a query within a transaction client or directly on the pool. */
  protected query(queryable: Queryable, text: string, values?: unknown[]) {
    return queryable.query(text, values);
  }

  /** Execute in a transaction, passing the client to the callback. */
  async withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
