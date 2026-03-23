import type { FastifyPluginAsync } from 'fastify';
import { TransactionRepository } from '../../db/repositories/transaction.repository.js';
import { InstructionEventRepository } from '../../db/repositories/instruction-event.repository.js';
import { AccountSnapshotRepository } from '../../db/repositories/account-snapshot.repository.js';
import { DecodingErrorRepository } from '../../db/repositories/decoding-error.repository.js';
import { CheckpointRepository } from '../../db/repositories/checkpoint.repository.js';

export const statsRoute: FastifyPluginAsync = async (app) => {
  const txRepo = new TransactionRepository(app.deps.pool);
  const ixRepo = new InstructionEventRepository(app.deps.pool);
  const accountRepo = new AccountSnapshotRepository(app.deps.pool);
  const errorRepo = new DecodingErrorRepository(app.deps.pool);
  const checkpointRepo = new CheckpointRepository(app.deps.pool);

  // GET /stats/program - Program-level statistics
  app.get('/program', async () => {
    const programId = app.deps.config.solanaProgramId;

    const [txStats, ixStats, accountStats, errorCount, checkpoint] = await Promise.all([
      txRepo.getStats(programId),
      ixRepo.getStats(programId),
      accountRepo.getStats(programId),
      errorRepo.getCount(programId),
      checkpointRepo.get(programId),
    ]);

    return {
      data: {
        programId,
        transactions: {
          total: txStats.totalTransactions,
          successful: txStats.successCount,
          failed: txStats.failureCount,
          latestSlot: txStats.latestSlot,
          firstSlot: txStats.firstSlot,
        },
        instructions: {
          total: ixStats.totalInstructions,
          uniqueNames: ixStats.uniqueInstructionNames,
          mostFrequent: ixStats.mostFrequent,
        },
        accounts: {
          totalSnapshots: accountStats.totalSnapshots,
          uniqueAccounts: accountStats.uniqueAccounts,
          types: accountStats.accountTypes,
        },
        decodingErrors: errorCount,
        checkpoint: checkpoint
          ? {
              lastSlot: Number(checkpoint.last_slot),
              lastSignature: checkpoint.last_signature,
              updatedAt: checkpoint.updated_at,
            }
          : null,
      },
    };
  });
};
