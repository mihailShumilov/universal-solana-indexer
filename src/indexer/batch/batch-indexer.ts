import { PublicKey } from '@solana/web3.js';
import type { SolanaClient } from '../../solana/client.js';
import type { InstructionDecoder, DecodedInstruction } from '../../decoder/instruction-decoder.js';
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

export interface BatchIndexerDeps {
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
 * Batch indexer: processes transactions in a slot range or from a signature list.
 *
 * Flow:
 * 1. Collect signatures (from slot range or provided list)
 * 2. Fetch and decode transactions in batches
 * 3. Persist decoded data atomically with checkpoint updates
 */
export class BatchIndexer {
  private readonly deps: BatchIndexerDeps;

  constructor(deps: BatchIndexerDeps) {
    this.deps = deps;
  }

  async run(): Promise<void> {
    const { config, logger, indexerRunRepo, shutdown } = this.deps;
    const programId = config.solanaProgramId;

    logger.info({ mode: 'batch', programId }, 'Starting batch indexer');

    const run = await indexerRunRepo.create(
      programId,
      'batch',
      config.batchStartSlot,
      config.batchEndSlot
    );

    try {
      let signatures: string[];

      if (config.batchSignatures && config.batchSignatures.length > 0) {
        signatures = config.batchSignatures;
        logger.info({ count: signatures.length }, 'Indexing from provided signature list');
      } else {
        signatures = await this.collectSignaturesFromSlotRange(
          programId,
          config.batchStartSlot!,
          config.batchEndSlot!
        );
        logger.info({ count: signatures.length }, 'Collected signatures from slot range');
      }

      await this.processSignatures(signatures, programId);
      await indexerRunRepo.finish(run.id, 'completed');
      logger.info('Batch indexing completed');
    } catch (err) {
      await indexerRunRepo.finish(run.id, shutdown.isShuttingDown ? 'stopped' : 'failed');
      throw err;
    }
  }

  private async collectSignaturesFromSlotRange(
    programId: string,
    startSlot: number,
    endSlot: number
  ): Promise<string[]> {
    const { solanaClient, logger, shutdown } = this.deps;
    const pubkey = new PublicKey(programId);
    const allSignatures: string[] = [];
    let before: string | undefined;

    logger.info({ startSlot, endSlot }, 'Collecting signatures from slot range');

    // Paginate through getSignaturesForAddress
    while (!shutdown.isShuttingDown) {
      const sigs = await solanaClient.getSignaturesForAddress(pubkey, {
        limit: 1000,
        before,
      });

      if (sigs.length === 0) break;

      for (const sig of sigs) {
        if (sig.slot < startSlot) {
          // We've gone past the start slot, stop
          return allSignatures;
        }
        if (sig.slot <= endSlot) {
          allSignatures.push(sig.signature);
        }
      }

      before = sigs[sigs.length - 1].signature;

      // If the last signature's slot is before our range, stop
      if (sigs[sigs.length - 1].slot < startSlot) break;
    }

    return allSignatures;
  }

  private async processSignatures(signatures: string[], programId: string): Promise<void> {
    const { config, solanaClient, logger, shutdown, checkpointRepo } = this.deps;
    const batchSize = config.batchSize;
    let processed = 0;

    for (let i = 0; i < signatures.length; i += batchSize) {
      if (shutdown.isShuttingDown) {
        logger.info('Shutdown requested, stopping batch processing');
        break;
      }

      const batch = signatures.slice(i, i + batchSize);
      const txs = await solanaClient.getParsedTransactions(batch);

      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        if (!tx) continue;

        try {
          await this.processTransaction(tx, batch[j], programId);
        } catch (err) {
          logger.error({ err, signature: batch[j] }, 'Failed to process transaction');
          await this.deps.decodingErrorRepo.insert({
            signature: batch[j],
            programId,
            errorType: 'processing_error',
            errorMessage: err instanceof Error ? err.message : String(err),
            slot: tx.slot,
          });
        }
      }

      processed += batch.length;

      // Update checkpoint periodically
      if (processed % config.checkpointCommitInterval === 0 || i + batchSize >= signatures.length) {
        const lastTx = txs.filter(Boolean).pop();
        if (lastTx) {
          await checkpointRepo.upsert(
            programId,
            lastTx.slot,
            batch[batch.length - 1],
            lastTx.blockTime ? new Date(lastTx.blockTime * 1000) : null
          );
        }
      }

      logger.info(
        { processed, total: signatures.length, batchIdx: Math.floor(i / batchSize) },
        'Batch progress'
      );
    }
  }

  private async processTransaction(
    tx: NonNullable<Awaited<ReturnType<SolanaClient['getParsedTransaction']>>>,
    signature: string,
    programId: string
  ): Promise<void> {
    const { transactionRepo, instructionEventRepo, accountSnapshotRepo, instructionDecoder, accountDecoder, pool } = this.deps;

    // Check idempotency
    if (await transactionRepo.exists(signature)) return;

    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
    const signers = tx.transaction.message.accountKeys
      .filter((k) => k.signer)
      .map((k) => k.pubkey.toBase58());

    // Decode instructions
    const decodedInstructions = instructionDecoder.decode(tx);

    // Persist atomically
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
        // Already exists (race condition), skip
        await client.query('ROLLBACK');
        return;
      }

      // Insert instruction events
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

      await client.query('COMMIT');

      // Decode account states (outside transaction for performance)
      const writableAddresses = accountDecoder.extractWritableAccounts(decodedInstructions);
      if (writableAddresses.length > 0) {
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
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
