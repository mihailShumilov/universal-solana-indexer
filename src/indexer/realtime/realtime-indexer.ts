import { PublicKey } from '@solana/web3.js';
import type { SolanaClient } from '../../solana/client.js';
import type { InstructionDecoder } from '../../decoder/instruction-decoder.js';
import type { AccountDecoder } from '../../decoder/account-decoder.js';
import type { TransactionRepository, TransactionInsert } from '../../db/repositories/transaction.repository.js';
import type { InstructionEventRepository, InstructionEventInsert } from '../../db/repositories/instruction-event.repository.js';
import type { AccountSnapshotRepository } from '../../db/repositories/account-snapshot.repository.js';
import type { CheckpointRepository } from '../../db/repositories/checkpoint.repository.js';
import type { DecodingErrorRepository } from '../../db/repositories/decoding-error.repository.js';
import type { IndexerRunRepository } from '../../db/repositories/indexer-run.repository.js';
import type { DbPool } from '../../db/pool.js';
import type { Logger } from '../../logger/index.js';
import type { GracefulShutdown } from '../../shutdown/shutdown.js';
import type { AppConfig } from '../../config/index.js';

export interface RealtimeIndexerDeps {
  config: AppConfig;
  solanaClient: SolanaClient;
  instructionDecoder: InstructionDecoder;
  accountDecoder: AccountDecoder;
  transactionRepo: TransactionRepository;
  instructionEventRepo: InstructionEventRepository;
  accountSnapshotRepo: AccountSnapshotRepository;
  checkpointRepo: CheckpointRepository;
  decodingErrorRepo: DecodingErrorRepository;
  indexerRunRepo: IndexerRunRepository;
  pool: DbPool;
  logger: Logger;
  shutdown: GracefulShutdown;
}

/**
 * Real-time indexer with cold start recovery.
 *
 * Flow:
 * 1. Read last checkpoint from DB
 * 2. Backfill missed transactions since checkpoint
 * 3. Subscribe to new transactions via logsSubscribe
 * 4. Process incoming transactions
 * 5. Persist checkpoints continuously
 */
export class RealtimeIndexer {
  private readonly deps: RealtimeIndexerDeps;
  private subscriptionId: number | null = null;

  constructor(deps: RealtimeIndexerDeps) {
    this.deps = deps;
  }

  async run(): Promise<void> {
    const { config, logger, indexerRunRepo, shutdown, checkpointRepo } = this.deps;
    const programId = config.solanaProgramId;

    logger.info({ mode: 'realtime', programId }, 'Starting real-time indexer');

    const run = await indexerRunRepo.create(programId, 'realtime');

    // Register cleanup
    shutdown.register('realtime-indexer', async () => {
      await this.stopSubscription();
      await indexerRunRepo.finish(run.id, 'stopped');
    });

    try {
      // Cold start: backfill if enabled
      if (config.backfillEnabled) {
        await this.backfill(programId);
      }

      // Start live subscription
      await this.subscribe(programId);

      // Keep running until shutdown
      await this.waitForShutdown();

      await indexerRunRepo.finish(run.id, 'completed');
    } catch (err) {
      if (!shutdown.isShuttingDown) {
        await indexerRunRepo.finish(run.id, 'failed');
        throw err;
      }
    }
  }

  /**
   * Cold start recovery: backfill from last checkpoint to current slot.
   */
  private async backfill(programId: string): Promise<void> {
    const { solanaClient, checkpointRepo, logger, shutdown } = this.deps;

    const checkpoint = await checkpointRepo.get(programId);
    const currentSlot = await solanaClient.getSlot();

    if (!checkpoint) {
      logger.info('No checkpoint found, starting from current slot');
      await checkpointRepo.upsert(programId, currentSlot);
      return;
    }

    const lastSlot = Number(checkpoint.last_slot);
    logger.info({ lastSlot, currentSlot, gap: currentSlot - lastSlot }, 'Cold start recovery: backfilling');

    if (currentSlot - lastSlot <= 0) {
      logger.info('No backfill needed, checkpoint is current');
      return;
    }

    // Collect missed signatures
    const pubkey = new PublicKey(programId);
    const missedSignatures: string[] = [];
    let before: string | undefined;

    while (!shutdown.isShuttingDown) {
      const sigs = await solanaClient.getSignaturesForAddress(pubkey, {
        limit: 1000,
        before,
        ...(checkpoint.last_signature ? { until: checkpoint.last_signature } : {}),
      });

      if (sigs.length === 0) break;

      for (const sig of sigs) {
        if (sig.slot <= lastSlot) break;
        missedSignatures.push(sig.signature);
      }

      if (sigs[sigs.length - 1].slot <= lastSlot) break;
      before = sigs[sigs.length - 1].signature;
    }

    if (missedSignatures.length > 0) {
      logger.info({ count: missedSignatures.length }, 'Backfilling missed transactions');
      // Process in reverse (oldest first)
      missedSignatures.reverse();

      const batchSize = this.deps.config.batchSize;
      for (let i = 0; i < missedSignatures.length; i += batchSize) {
        if (shutdown.isShuttingDown) break;

        const batch = missedSignatures.slice(i, i + batchSize);
        const txs = await solanaClient.getParsedTransactions(batch);

        for (let j = 0; j < txs.length; j++) {
          if (txs[j]) {
            await this.processTransaction(txs[j]!, batch[j], programId);
          }
        }
      }

      logger.info('Backfill completed');
    } else {
      logger.info('No missed transactions to backfill');
    }
  }

  /**
   * Subscribe to program logs for real-time indexing.
   */
  private async subscribe(programId: string): Promise<void> {
    const { solanaClient, logger, shutdown, config } = this.deps;

    logger.info('Starting real-time log subscription');

    const programPubkey = new PublicKey(programId);
    let processedCount = 0;

    this.subscriptionId = solanaClient.connection.onLogs(
      programPubkey,
      async (logs) => {
        if (shutdown.isShuttingDown) return;

        const signature = logs.signature;

        try {
          const tx = await solanaClient.getParsedTransaction(
            signature,
            config.realtimeConfirmation
          );

          if (tx) {
            await this.processTransaction(tx, signature, programId);
            processedCount++;

            if (processedCount % 10 === 0) {
              logger.info({ processedCount }, 'Real-time indexing progress');
            }
          }
        } catch (err) {
          logger.error({ err, signature }, 'Failed to process real-time transaction');
          await this.deps.decodingErrorRepo.insert({
            signature,
            programId,
            errorType: 'realtime_processing_error',
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      },
      config.realtimeConfirmation
    );

    logger.info({ subscriptionId: this.subscriptionId }, 'Log subscription active');
  }

  private async stopSubscription(): Promise<void> {
    if (this.subscriptionId !== null) {
      try {
        await this.deps.solanaClient.connection.removeOnLogsListener(this.subscriptionId);
        this.deps.logger.info('Log subscription removed');
      } catch (err) {
        this.deps.logger.warn({ err }, 'Failed to remove log subscription');
      }
      this.subscriptionId = null;
    }
  }

  private async processTransaction(
    tx: NonNullable<Awaited<ReturnType<SolanaClient['getParsedTransaction']>>>,
    signature: string,
    programId: string
  ): Promise<void> {
    const {
      transactionRepo,
      instructionEventRepo,
      accountSnapshotRepo,
      instructionDecoder,
      accountDecoder,
      checkpointRepo,
      decodingErrorRepo,
      pool,
      logger,
    } = this.deps;

    if (await transactionRepo.exists(signature)) return;

    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
    const signers = tx.transaction.message.accountKeys
      .filter((k) => k.signer)
      .map((k) => k.pubkey.toBase58());

    const decodedInstructions = instructionDecoder.decode(tx);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const txInsert: TransactionInsert = {
        signature,
        slot: tx.slot,
        blockTime,
        success: tx.meta?.err === null,
        fee: tx.meta?.fee ?? null,
        signers,
        programId,
      };

      const txRecord = await transactionRepo.insert(txInsert, client);
      if (!txRecord) {
        await client.query('ROLLBACK');
        return;
      }

      if (decodedInstructions.length > 0) {
        const events: InstructionEventInsert[] = decodedInstructions.map((di) => ({
          transactionId: txRecord.id,
          signature,
          programId,
          instructionName: di.name,
          instructionIndex: di.instructionIndex,
          isInnerInstruction: di.isInnerInstruction,
          accounts: di.accounts,
          decodedArgs: di.decodedArgs,
          rawData: di.rawData,
          slot: tx.slot,
          blockTime,
        }));
        await instructionEventRepo.insertBatch(events, client);
      }

      // Update checkpoint atomically with data
      await checkpointRepo.upsert(programId, tx.slot, signature, blockTime, client);

      await client.query('COMMIT');

      // Account decoding outside transaction
      const writableAddresses = accountDecoder.extractWritableAccounts(decodedInstructions);
      if (writableAddresses.length > 0) {
        try {
          const accountStates = await accountDecoder.decodeAccounts(writableAddresses);
          for (const state of accountStates) {
            await accountSnapshotRepo.upsert({
              accountAddress: state.accountAddress,
              programId,
              accountType: state.accountType,
              slot: tx.slot,
              decodedData: state.decodedData,
              dataHash: state.dataHash,
              blockTime,
            });
          }
        } catch (err) {
          logger.warn({ err, signature }, 'Account decoding failed (non-fatal)');
        }
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.deps.shutdown.isShuttingDown) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    });
  }
}
