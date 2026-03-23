import type { NormalizedIdl } from '../idl/normalizer.js';
import type { SchemaMetadataRepository, SchemaMetadataInsert } from '../db/repositories/schema-metadata.repository.js';
import type { ProgramRepository } from '../db/repositories/program.repository.js';
import type { Logger } from '../logger/index.js';
import { createHash } from 'crypto';

export interface SchemaMetadataEntry {
  entityType: 'instruction' | 'account';
  entityName: string;
  fields: { name: string; type: string }[];
  discriminator: string | null;
}

/**
 * Generates and persists IDL-driven schema metadata.
 *
 * Strategy: hybrid approach — stable relational tables + JSONB data + metadata registry.
 * The metadata describes what instructions and accounts exist per IDL,
 * enabling the API to expose IDL-aware query capabilities without hardcoding.
 */
export class SchemaGenerator {
  constructor(
    private readonly programRepo: ProgramRepository,
    private readonly schemaRepo: SchemaMetadataRepository,
    private readonly logger: Logger
  ) {}

  /** Generate and persist schema metadata from the normalized IDL. */
  async generate(programId: string, idl: NormalizedIdl): Promise<SchemaMetadataEntry[]> {
    const idlHash = createHash('sha256').update(JSON.stringify(idl.raw)).digest('hex').slice(0, 16);

    // Upsert program record
    await this.programRepo.upsert(programId, idlHash, idl.raw);

    const entries: SchemaMetadataEntry[] = [];
    const inserts: SchemaMetadataInsert[] = [];

    // Generate instruction metadata
    for (const ix of idl.instructions) {
      const fields = ix.args.map((a) => ({ name: a.name, type: a.type }));
      const accountFields = ix.accounts.map((a) => ({
        name: a.name,
        type: `account:${a.isMut ? 'mut' : 'readonly'}:${a.isSigner ? 'signer' : 'nosigner'}`,
      }));

      const entry: SchemaMetadataEntry = {
        entityType: 'instruction',
        entityName: ix.name,
        fields: [...fields, ...accountFields],
        discriminator: ix.discriminator ? Buffer.from(ix.discriminator).toString('hex') : null,
      };
      entries.push(entry);

      inserts.push({
        programId,
        entityType: 'instruction',
        entityName: ix.name,
        fields: entry.fields,
        discriminator: entry.discriminator || undefined,
      });
    }

    // Generate account metadata
    for (const acc of idl.accounts) {
      const fields = acc.fields.map((f) => ({ name: f.name, type: f.type }));
      const entry: SchemaMetadataEntry = {
        entityType: 'account',
        entityName: acc.name,
        fields,
        discriminator: acc.discriminator ? Buffer.from(acc.discriminator).toString('hex') : null,
      };
      entries.push(entry);

      inserts.push({
        programId,
        entityType: 'account',
        entityName: acc.name,
        fields: entry.fields,
        discriminator: entry.discriminator || undefined,
      });
    }

    // Persist all metadata
    await this.schemaRepo.upsertBatch(inserts);

    this.logger.info(
      {
        programId,
        instructions: idl.instructions.length,
        accounts: idl.accounts.length,
        idlHash,
      },
      'Schema metadata generated and persisted'
    );

    return entries;
  }
}
