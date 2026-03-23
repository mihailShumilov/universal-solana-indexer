import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { InstructionEventRepository } from '../../db/repositories/instruction-event.repository.js';

const querySchema = z.object({
  instruction_name: z.string().optional(),
  time_from: z.string().datetime().optional(),
  time_to: z.string().datetime().optional(),
  group_by: z.enum(['day', 'hour']).optional(),
  program_id: z.string().optional(),
});

export const aggregationsRoute: FastifyPluginAsync = async (app) => {
  const ixRepo = new InstructionEventRepository(app.deps.pool);

  // GET /aggregations/instructions - Aggregated instruction counts
  app.get('/instructions', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parsed.error.issues };
    }

    const q = parsed.data;
    const programId = q.program_id || app.deps.config.solanaProgramId;

    const data = await ixRepo.getAggregation({
      programId,
      instructionName: q.instruction_name,
      timeFrom: q.time_from ? new Date(q.time_from) : undefined,
      timeTo: q.time_to ? new Date(q.time_to) : undefined,
      groupBy: q.group_by,
    });

    return { data };
  });
};
