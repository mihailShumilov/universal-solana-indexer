import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { InstructionEventRepository } from '../../db/repositories/instruction-event.repository.js';

const querySchema = z.object({
  instruction_name: z.string().optional(),
  signer: z.string().optional(),
  slot_from: z.coerce.number().int().nonnegative().optional(),
  slot_to: z.coerce.number().int().nonnegative().optional(),
  time_from: z.string().datetime().optional(),
  time_to: z.string().datetime().optional(),
  program_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const instructionsRoute: FastifyPluginAsync = async (app) => {
  const ixRepo = new InstructionEventRepository(app.deps.pool);

  app.get('/', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parsed.error.issues };
    }

    const q = parsed.data;
    const result = await ixRepo.findWithFilters({
      programId: q.program_id || app.deps.config.solanaProgramId,
      instructionName: q.instruction_name,
      signer: q.signer,
      slotFrom: q.slot_from,
      slotTo: q.slot_to,
      timeFrom: q.time_from ? new Date(q.time_from) : undefined,
      timeTo: q.time_to ? new Date(q.time_to) : undefined,
      limit: Math.min(q.limit, app.deps.config.pageSizeMax),
      offset: q.offset,
    });

    return {
      data: result.rows,
      pagination: {
        total: result.total,
        limit: q.limit,
        offset: q.offset,
        hasMore: q.offset + q.limit < result.total,
      },
    };
  });
};
