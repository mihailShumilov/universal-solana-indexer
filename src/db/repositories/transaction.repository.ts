import { BaseRepository, type Queryable } from './base.repository.js';

export interface TransactionInsert {
  signature: string;
  slot: number;
  blockTime: Date | null;
  success: boolean;
  fee: number | null;
  signers: string[];
  programId: string;
  rawMeta?: unknown;
}

export interface TransactionRecord {
  id: number;
  signature: string;
  slot: number;
  block_time: Date | null;
  success: boolean;
  fee: number | null;
  signers: string[];
  program_id: string;
  raw_meta: unknown;
  created_at: Date;
}

export interface TransactionFilter {
  instructionName?: string;
  signer?: string;
  slotFrom?: number;
  slotTo?: number;
  timeFrom?: Date;
  timeTo?: Date;
  success?: boolean;
  accountAddress?: string;
  programId?: string;
  limit: number;
  offset: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export class TransactionRepository extends BaseRepository {
  async insert(tx: TransactionInsert, client?: Queryable): Promise<TransactionRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO transactions (signature, slot, block_time, success, fee, signers, program_id, raw_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (signature) DO NOTHING
       RETURNING *`,
      [tx.signature, tx.slot, tx.blockTime, tx.success, tx.fee, tx.signers, tx.programId, tx.rawMeta ? JSON.stringify(tx.rawMeta) : null]
    );
    return rows[0];
  }

  async findBySignature(signature: string): Promise<TransactionRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM transactions WHERE signature = $1', [signature]);
    return rows[0] || null;
  }

  async exists(signature: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM transactions WHERE signature = $1', [signature]);
    return rows.length > 0;
  }

  async findWithFilters(filter: TransactionFilter): Promise<{ rows: TransactionRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (filter.programId) {
      conditions.push(`t.program_id = $${paramIdx++}`);
      values.push(filter.programId);
    }
    if (filter.signer) {
      conditions.push(`$${paramIdx++} = ANY(t.signers)`);
      values.push(filter.signer);
    }
    if (filter.slotFrom !== undefined) {
      conditions.push(`t.slot >= $${paramIdx++}`);
      values.push(filter.slotFrom);
    }
    if (filter.slotTo !== undefined) {
      conditions.push(`t.slot <= $${paramIdx++}`);
      values.push(filter.slotTo);
    }
    if (filter.timeFrom) {
      conditions.push(`t.block_time >= $${paramIdx++}`);
      values.push(filter.timeFrom);
    }
    if (filter.timeTo) {
      conditions.push(`t.block_time <= $${paramIdx++}`);
      values.push(filter.timeTo);
    }
    if (filter.success !== undefined) {
      conditions.push(`t.success = $${paramIdx++}`);
      values.push(filter.success);
    }
    if (filter.instructionName) {
      conditions.push(
        `EXISTS (SELECT 1 FROM instruction_events ie WHERE ie.transaction_id = t.id AND ie.instruction_name = $${paramIdx++})`
      );
      values.push(filter.instructionName);
    }
    if (filter.accountAddress) {
      conditions.push(
        `EXISTS (SELECT 1 FROM instruction_events ie WHERE ie.transaction_id = t.id AND ie.accounts @> $${paramIdx++}::jsonb)`
      );
      values.push(JSON.stringify([{ pubkey: filter.accountAddress }]));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = filter.orderBy === 'block_time' ? 't.block_time' : 't.slot';
    const orderDir = filter.orderDir === 'asc' ? 'ASC' : 'DESC';

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM transactions t ${where}`, values);
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await this.pool.query(
      `SELECT t.* FROM transactions t ${where} ORDER BY ${orderBy} ${orderDir} NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, filter.limit, filter.offset]
    );

    return { rows: dataResult.rows, total };
  }

  async getStats(programId: string): Promise<{
    totalTransactions: number;
    latestSlot: number | null;
    firstSlot: number | null;
    successCount: number;
    failureCount: number;
  }> {
    const { rows } = await this.pool.query(
      `SELECT
        COUNT(*)::int as total_transactions,
        MAX(slot) as latest_slot,
        MIN(slot) as first_slot,
        COUNT(*) FILTER (WHERE success = true)::int as success_count,
        COUNT(*) FILTER (WHERE success = false)::int as failure_count
       FROM transactions WHERE program_id = $1`,
      [programId]
    );
    const r = rows[0];
    return {
      totalTransactions: r.total_transactions,
      latestSlot: r.latest_slot ? Number(r.latest_slot) : null,
      firstSlot: r.first_slot ? Number(r.first_slot) : null,
      successCount: r.success_count,
      failureCount: r.failure_count,
    };
  }
}
