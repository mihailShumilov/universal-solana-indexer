import { BaseRepository, type Queryable } from './base.repository.js';

export interface DecodingErrorInsert {
  signature?: string;
  programId: string;
  errorType: string;
  errorMessage: string;
  context?: unknown;
  slot?: number;
}

export class DecodingErrorRepository extends BaseRepository {
  async insert(error: DecodingErrorInsert, client?: Queryable): Promise<void> {
    const q = client || this.pool;
    await this.query(
      q,
      `INSERT INTO decoding_errors (signature, program_id, error_type, error_message, context, slot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        error.signature || null,
        error.programId,
        error.errorType,
        error.errorMessage,
        error.context ? JSON.stringify(error.context) : '{}',
        error.slot || null,
      ]
    );
  }

  async getCount(programId: string): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int as cnt FROM decoding_errors WHERE program_id = $1',
      [programId]
    );
    return rows[0].cnt;
  }
}
