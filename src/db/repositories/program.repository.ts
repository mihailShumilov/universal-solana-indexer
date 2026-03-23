import { BaseRepository, type Queryable } from './base.repository.js';

export interface ProgramRecord {
  id: number;
  program_id: string;
  idl_hash: string;
  idl_json: unknown;
  created_at: Date;
  updated_at: Date;
}

export class ProgramRepository extends BaseRepository {
  async upsert(programId: string, idlHash: string, idlJson: unknown, client?: Queryable): Promise<ProgramRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO programs (program_id, idl_hash, idl_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (program_id) DO UPDATE SET idl_hash = $2, idl_json = $3, updated_at = NOW()
       RETURNING *`,
      [programId, idlHash, JSON.stringify(idlJson)]
    );
    return rows[0];
  }

  async findByProgramId(programId: string): Promise<ProgramRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM programs WHERE program_id = $1', [programId]);
    return rows[0] || null;
  }
}
