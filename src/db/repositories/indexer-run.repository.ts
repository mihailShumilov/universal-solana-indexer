import { BaseRepository, type Queryable } from './base.repository.js';

export interface IndexerRunRecord {
  id: number;
  program_id: string;
  mode: string;
  status: string;
  start_slot: number | null;
  end_slot: number | null;
  started_at: Date;
  finished_at: Date | null;
  metadata: unknown;
}

export class IndexerRunRepository extends BaseRepository {
  async create(programId: string, mode: string, startSlot?: number, endSlot?: number, client?: Queryable): Promise<IndexerRunRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO indexer_runs (program_id, mode, start_slot, end_slot)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [programId, mode, startSlot || null, endSlot || null]
    );
    return rows[0];
  }

  async finish(id: number, status: 'completed' | 'failed' | 'stopped', client?: Queryable): Promise<void> {
    const q = client || this.pool;
    await this.query(q, `UPDATE indexer_runs SET status = $1, finished_at = NOW() WHERE id = $2`, [status, id]);
  }
}
