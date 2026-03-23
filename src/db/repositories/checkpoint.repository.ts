import { BaseRepository, type Queryable } from './base.repository.js';

export interface CheckpointRecord {
  id: number;
  program_id: string;
  last_slot: number;
  last_signature: string | null;
  last_block_time: Date | null;
  updated_at: Date;
}

export class CheckpointRepository extends BaseRepository {
  async upsert(
    programId: string,
    lastSlot: number,
    lastSignature?: string,
    lastBlockTime?: Date | null,
    client?: Queryable
  ): Promise<CheckpointRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO checkpoints (program_id, last_slot, last_signature, last_block_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (program_id) DO UPDATE SET
         last_slot = $2, last_signature = $3, last_block_time = $4, updated_at = NOW()
       RETURNING *`,
      [programId, lastSlot, lastSignature || null, lastBlockTime || null]
    );
    return rows[0];
  }

  async get(programId: string): Promise<CheckpointRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM checkpoints WHERE program_id = $1', [programId]);
    return rows[0] || null;
  }
}
