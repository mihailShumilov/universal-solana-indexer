import type { FastifyPluginAsync } from 'fastify';
import { SchemaMetadataRepository } from '../../db/repositories/schema-metadata.repository.js';

export const schemaRoute: FastifyPluginAsync = async (app) => {
  const schemaRepo = new SchemaMetadataRepository(app.deps.pool);

  // GET /schema - Get IDL-driven schema metadata
  app.get('/', async () => {
    const programId = app.deps.config.solanaProgramId;
    const metadata = await schemaRepo.findByProgram(programId);

    const instructions = metadata.filter((m) => m.entity_type === 'instruction');
    const accounts = metadata.filter((m) => m.entity_type === 'account');

    return {
      data: {
        programId,
        instructions: instructions.map((m) => ({
          name: m.entity_name,
          fields: m.fields,
          discriminator: m.discriminator,
        })),
        accounts: accounts.map((m) => ({
          name: m.entity_name,
          fields: m.fields,
          discriminator: m.discriminator,
        })),
      },
    };
  });
};
