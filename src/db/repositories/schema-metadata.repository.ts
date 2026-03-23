import { BaseRepository, type Queryable } from './base.repository.js';

export interface SchemaMetadataInsert {
  programId: string;
  entityType: 'instruction' | 'account';
  entityName: string;
  fields: unknown[];
  discriminator?: string;
}

export interface SchemaMetadataRecord {
  id: number;
  program_id: string;
  entity_type: string;
  entity_name: string;
  fields: unknown[];
  discriminator: string | null;
  created_at: Date;
}

export class SchemaMetadataRepository extends BaseRepository {
  async upsert(meta: SchemaMetadataInsert, client?: Queryable): Promise<SchemaMetadataRecord> {
    const q = client || this.pool;
    const { rows } = await this.query(
      q,
      `INSERT INTO schema_metadata (program_id, entity_type, entity_name, fields, discriminator)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (program_id, entity_type, entity_name) DO UPDATE SET
         fields = $4, discriminator = $5
       RETURNING *`,
      [meta.programId, meta.entityType, meta.entityName, JSON.stringify(meta.fields), meta.discriminator || null]
    );
    return rows[0];
  }

  async upsertBatch(metas: SchemaMetadataInsert[], client?: Queryable): Promise<void> {
    for (const meta of metas) {
      await this.upsert(meta, client);
    }
  }

  async findByProgram(programId: string): Promise<SchemaMetadataRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM schema_metadata WHERE program_id = $1 ORDER BY entity_type, entity_name',
      [programId]
    );
    return rows;
  }

  async findByProgramAndType(programId: string, entityType: 'instruction' | 'account'): Promise<SchemaMetadataRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM schema_metadata WHERE program_id = $1 AND entity_type = $2 ORDER BY entity_name',
      [programId, entityType]
    );
    return rows;
  }
}
