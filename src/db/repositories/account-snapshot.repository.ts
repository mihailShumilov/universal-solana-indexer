import { BaseRepository, type Queryable } from './base.repository.js';

export interface AccountSnapshotInsert {
  accountAddress: string;
  programId: string;
  accountType: string;
  slot: number;
  decodedData: unknown;
  dataHash?: string;
  blockTime: Date | null;
}

export interface AccountSnapshotRecord {
  id: number;
  account_address: string;
  program_id: string;
  account_type: string;
  slot: number;
  decoded_data: unknown;
  data_hash: string | null;
  block_time: Date | null;
  created_at: Date;
}

export class AccountSnapshotRepository extends BaseRepository {
  async upsert(snapshot: AccountSnapshotInsert, client?: Queryable): Promise<AccountSnapshotRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO account_snapshots (account_address, program_id, account_type, slot, decoded_data, data_hash, block_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (account_address, slot) DO UPDATE SET
         decoded_data = $5, data_hash = $6, block_time = $7
       RETURNING *`,
      [
        snapshot.accountAddress,
        snapshot.programId,
        snapshot.accountType,
        snapshot.slot,
        JSON.stringify(snapshot.decodedData),
        snapshot.dataHash || null,
        snapshot.blockTime,
      ]
    );
    return rows[0];
  }

  async findByAddress(address: string, limit: number = 10): Promise<AccountSnapshotRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM account_snapshots WHERE account_address = $1 ORDER BY slot DESC LIMIT $2',
      [address, limit]
    );
    return rows;
  }

  async findLatestByAddress(address: string): Promise<AccountSnapshotRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM account_snapshots WHERE account_address = $1 ORDER BY slot DESC LIMIT 1',
      [address]
    );
    return rows[0] || null;
  }

  async getStats(programId: string): Promise<{
    totalSnapshots: number;
    uniqueAccounts: number;
    accountTypes: string[];
  }> {
    const { rows } = await this.pool.query(
      `SELECT
        COUNT(*)::int as total_snapshots,
        COUNT(DISTINCT account_address)::int as unique_accounts
       FROM account_snapshots WHERE program_id = $1`,
      [programId]
    );
    const typeResult = await this.pool.query(
      `SELECT DISTINCT account_type FROM account_snapshots WHERE program_id = $1 ORDER BY account_type`,
      [programId]
    );
    return {
      totalSnapshots: rows[0].total_snapshots,
      uniqueAccounts: rows[0].unique_accounts,
      accountTypes: typeResult.rows.map((r: { account_type: string }) => r.account_type),
    };
  }
}
