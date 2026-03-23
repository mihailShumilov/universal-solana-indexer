import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
  type AccountInfo,
  type Commitment,
  type Finality,
} from '@solana/web3.js';
import { withRetry, type RetryOptions } from '../retry/index.js';
import type { Logger } from '../logger/index.js';

export interface SolanaClientOptions {
  httpUrl: string;
  wsUrl: string;
  retryOptions: RetryOptions;
  logger: Logger;
}

/**
 * Wrapper around @solana/web3.js Connection with built-in retry.
 */
export class SolanaClient {
  readonly connection: Connection;
  private readonly retryOpts: RetryOptions;
  private readonly logger: Logger;

  constructor(options: SolanaClientOptions) {
    this.connection = new Connection(options.httpUrl, {
      wsEndpoint: options.wsUrl,
      commitment: 'confirmed',
    });
    this.retryOpts = options.retryOptions;
    this.logger = options.logger;
  }

  async getSlot(commitment: Commitment = 'confirmed'): Promise<number> {
    return withRetry(() => this.connection.getSlot(commitment), {
      ...this.retryOpts,
      label: 'getSlot',
    });
  }

  async getSignaturesForAddress(
    address: PublicKey,
    options?: {
      limit?: number;
      before?: string;
      until?: string;
      minContextSlot?: number;
    },
    commitment?: Finality
  ): Promise<ConfirmedSignatureInfo[]> {
    return withRetry(
      () => this.connection.getSignaturesForAddress(address, options, commitment),
      { ...this.retryOpts, label: 'getSignaturesForAddress' }
    );
  }

  async getParsedTransaction(
    signature: string,
    commitment: Finality = 'confirmed'
  ): Promise<ParsedTransactionWithMeta | null> {
    return withRetry(
      () => this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment }),
      { ...this.retryOpts, label: 'getParsedTransaction' }
    );
  }

  async getParsedTransactions(
    signatures: string[],
    commitment: Finality = 'confirmed'
  ): Promise<(ParsedTransactionWithMeta | null)[]> {
    return withRetry(
      () => this.connection.getParsedTransactions(
        signatures,
        { maxSupportedTransactionVersion: 0, commitment }
      ),
      { ...this.retryOpts, label: 'getParsedTransactions' }
    );
  }

  async getAccountInfo(
    address: PublicKey,
    commitment: Commitment = 'confirmed'
  ): Promise<AccountInfo<Buffer> | null> {
    return withRetry(
      () => this.connection.getAccountInfo(address, commitment),
      { ...this.retryOpts, label: 'getAccountInfo' }
    );
  }

  async getMultipleAccountsInfo(
    addresses: PublicKey[],
    commitment: Commitment = 'confirmed'
  ): Promise<(AccountInfo<Buffer> | null)[]> {
    return withRetry(
      () => this.connection.getMultipleAccountsInfo(addresses, commitment),
      { ...this.retryOpts, label: 'getMultipleAccountsInfo' }
    );
  }

  async getBlockSignatures(slot: number): Promise<string[]> {
    return withRetry(
      async () => {
        const block = await this.connection.getBlock(slot, {
          transactionDetails: 'signatures',
          rewards: false,
          maxSupportedTransactionVersion: 0,
        }) as any;
        if (!block) return [];
        return block.signatures || [];
      },
      { ...this.retryOpts, label: `getBlockSignatures:${slot}` }
    );
  }
}
