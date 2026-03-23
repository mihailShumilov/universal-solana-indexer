import { BaseRepository, type Queryable } from './base.repository.js';

export interface InstructionEventInsert {
  transactionId: number;
  signature: string;
  programId: string;
  instructionName: string;
  instructionIndex: number;
  isInnerInstruction: boolean;
  accounts: unknown[];
  decodedArgs: unknown;
  rawData?: string;
  slot: number;
  blockTime: Date | null;
}

export interface InstructionEventRecord {
  id: number;
  transaction_id: number;
  signature: string;
  program_id: string;
  instruction_name: string;
  instruction_index: number;
  is_inner_instruction: boolean;
  accounts: unknown[];
  decoded_args: unknown;
  raw_data: string | null;
  slot: number;
  block_time: Date | null;
  created_at: Date;
}

export interface InstructionFilter {
  programId?: string;
  instructionName?: string;
  signer?: string;
  slotFrom?: number;
  slotTo?: number;
  timeFrom?: Date;
  timeTo?: Date;
  limit: number;
  offset: number;
}

export class InstructionEventRepository extends BaseRepository {
  async insert(event: InstructionEventInsert, client?: Queryable): Promise<InstructionEventRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO instruction_events
        (transaction_id, signature, program_id, instruction_name, instruction_index,
         is_inner_instruction, accounts, decoded_args, raw_data, slot, block_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        event.transactionId,
        event.signature,
        event.programId,
        event.instructionName,
        event.instructionIndex,
        event.isInnerInstruction,
        JSON.stringify(event.accounts),
        JSON.stringify(event.decodedArgs),
        event.rawData || null,
        event.slot,
        event.blockTime,
      ]
    );
    return rows[0];
  }

  async insertBatch(events: InstructionEventInsert[], client?: Queryable): Promise<void> {
    if (events.length === 0) return;
    const q = client || this.pool;

    const valuesClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const e of events) {
      valuesClauses.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        e.transactionId, e.signature, e.programId, e.instructionName, e.instructionIndex,
        e.isInnerInstruction, JSON.stringify(e.accounts), JSON.stringify(e.decodedArgs),
        e.rawData || null, e.slot, e.blockTime
      );
    }

    await this.query(
      q,
      `INSERT INTO instruction_events
        (transaction_id, signature, program_id, instruction_name, instruction_index,
         is_inner_instruction, accounts, decoded_args, raw_data, slot, block_time)
       VALUES ${valuesClauses.join(', ')}`,
      values
    );
  }

  async findWithFilters(filter: InstructionFilter): Promise<{ rows: InstructionEventRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (filter.programId) {
      conditions.push(`ie.program_id = $${paramIdx++}`);
      values.push(filter.programId);
    }
    if (filter.instructionName) {
      conditions.push(`ie.instruction_name = $${paramIdx++}`);
      values.push(filter.instructionName);
    }
    if (filter.slotFrom !== undefined) {
      conditions.push(`ie.slot >= $${paramIdx++}`);
      values.push(filter.slotFrom);
    }
    if (filter.slotTo !== undefined) {
      conditions.push(`ie.slot <= $${paramIdx++}`);
      values.push(filter.slotTo);
    }
    if (filter.timeFrom) {
      conditions.push(`ie.block_time >= $${paramIdx++}`);
      values.push(filter.timeFrom);
    }
    if (filter.timeTo) {
      conditions.push(`ie.block_time <= $${paramIdx++}`);
      values.push(filter.timeTo);
    }
    if (filter.signer) {
      conditions.push(
        `EXISTS (SELECT 1 FROM transactions t WHERE t.id = ie.transaction_id AND $${paramIdx++} = ANY(t.signers))`
      );
      values.push(filter.signer);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM instruction_events ie ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await this.pool.query(
      `SELECT ie.* FROM instruction_events ie ${where} ORDER BY ie.slot DESC, ie.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, filter.limit, filter.offset]
    );

    return { rows: dataResult.rows, total };
  }

  async getAggregation(params: {
    programId: string;
    instructionName?: string;
    timeFrom?: Date;
    timeTo?: Date;
    groupBy?: 'day' | 'hour';
  }): Promise<unknown[]> {
    const conditions: string[] = ['ie.program_id = $1'];
    const values: unknown[] = [params.programId];
    let paramIdx = 2;

    if (params.instructionName) {
      conditions.push(`ie.instruction_name = $${paramIdx++}`);
      values.push(params.instructionName);
    }
    if (params.timeFrom) {
      conditions.push(`ie.block_time >= $${paramIdx++}`);
      values.push(params.timeFrom);
    }
    if (params.timeTo) {
      conditions.push(`ie.block_time <= $${paramIdx++}`);
      values.push(params.timeTo);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    if (params.groupBy) {
      const trunc = params.groupBy === 'day' ? 'day' : 'hour';
      const { rows } = await this.pool.query(
        `SELECT
          date_trunc('${trunc}', ie.block_time) as period,
          ie.instruction_name,
          COUNT(*)::int as count
         FROM instruction_events ie ${where}
         GROUP BY period, ie.instruction_name
         ORDER BY period DESC`,
        values
      );
      return rows;
    }

    const { rows } = await this.pool.query(
      `SELECT ie.instruction_name, COUNT(*)::int as count
       FROM instruction_events ie ${where}
       GROUP BY ie.instruction_name
       ORDER BY count DESC`,
      values
    );
    return rows;
  }

  async getStats(programId: string): Promise<{
    totalInstructions: number;
    uniqueInstructionNames: string[];
    mostFrequent: string | null;
  }> {
    const { rows } = await this.pool.query(
      `SELECT instruction_name, COUNT(*)::int as cnt
       FROM instruction_events WHERE program_id = $1
       GROUP BY instruction_name ORDER BY cnt DESC`,
      [programId]
    );
    return {
      totalInstructions: rows.reduce((sum: number, r: { cnt: number }) => sum + r.cnt, 0),
      uniqueInstructionNames: rows.map((r: { instruction_name: string }) => r.instruction_name),
      mostFrequent: rows.length > 0 ? rows[0].instruction_name : null,
    };
  }
}
