import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TransactionRepository } from '../../db/repositories/transaction.repository.js';
import { InstructionEventRepository } from '../../db/repositories/instruction-event.repository.js';
import { AccountSnapshotRepository } from '../../db/repositories/account-snapshot.repository.js';

const querySchema = z.object({
  instruction_name: z.string().optional(),
  signer: z.string().optional(),
  slot_from: z.coerce.number().int().nonnegative().optional(),
  slot_to: z.coerce.number().int().nonnegative().optional(),
  time_from: z.string().datetime().optional(),
  time_to: z.string().datetime().optional(),
  success: z.enum(['true', 'false']).optional().transform((v) => v === undefined ? undefined : v === 'true'),
  account_address: z.string().optional(),
  program_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  order_by: z.enum(['slot', 'block_time']).default('slot'),
  order_dir: z.enum(['asc', 'desc']).default('desc'),
});

export const transactionsRoute: FastifyPluginAsync = async (app) => {
  const txRepo = new TransactionRepository(app.deps.pool);
  const ixRepo = new InstructionEventRepository(app.deps.pool);
  const accountRepo = new AccountSnapshotRepository(app.deps.pool);

  // GET /transactions - List with filters
  app.get('/', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parsed.error.issues };
    }

    const q = parsed.data;
    const result = await txRepo.findWithFilters({
      instructionName: q.instruction_name,
      signer: q.signer,
      slotFrom: q.slot_from,
      slotTo: q.slot_to,
      timeFrom: q.time_from ? new Date(q.time_from) : undefined,
      timeTo: q.time_to ? new Date(q.time_to) : undefined,
      success: q.success,
      accountAddress: q.account_address,
      programId: q.program_id || app.deps.config.solanaProgramId,
      limit: Math.min(q.limit, app.deps.config.pageSizeMax),
      offset: q.offset,
      orderBy: q.order_by,
      orderDir: q.order_dir,
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

  // GET /transactions/:signature - Get by signature
  app.get<{ Params: { signature: string } }>('/:signature', async (request, reply) => {
    const { signature } = request.params;

    const tx = await txRepo.findBySignature(signature);
    if (!tx) {
      reply.status(404);
      return { error: 'Transaction not found' };
    }

    // Fetch related instruction events
    const ixResult = await ixRepo.findWithFilters({
      programId: tx.program_id,
      limit: 100,
      offset: 0,
    });
    const instructions = ixResult.rows.filter((r) => r.signature === signature);

    // Fetch account snapshots for this slot
    const accountAddresses = new Set<string>();
    for (const ix of instructions) {
      const accounts = ix.accounts as { pubkey: string }[];
      for (const acc of accounts) {
        if (acc.pubkey) accountAddresses.add(acc.pubkey);
      }
    }

    const accountSnapshots: unknown[] = [];
    for (const addr of accountAddresses) {
      const snap = await accountRepo.findLatestByAddress(addr);
      if (snap && snap.slot <= tx.slot) {
        accountSnapshots.push(snap);
      }
    }

    return {
      data: {
        transaction: tx,
        instructions,
        accountSnapshots,
      },
    };
  });
};
