import { BorshCoder } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import type { NormalizedIdl, NormalizedAccount } from '../idl/normalizer.js';
import { adaptIdlForCoder } from '../idl/adapter.js';
import type { SolanaClient } from '../solana/client.js';
import type { Logger } from '../logger/index.js';

export interface DecodedAccountState {
  accountAddress: string;
  accountType: string;
  decodedData: Record<string, unknown>;
  dataHash: string;
}

/**
 * Decodes program-owned account states using the Anchor IDL.
 *
 * Strategy:
 * 1. For each instruction's account list, identify writable program-owned accounts
 * 2. Fetch their on-chain data
 * 3. Try to decode via BorshCoder using each known account type's discriminator
 * 4. Persist decoded snapshots
 */
export class AccountDecoder {
  private coder: BorshCoder | null = null;
  private readonly discriminatorMap: Map<string, NormalizedAccount> = new Map();

  constructor(
    private readonly idl: NormalizedIdl,
    private readonly programId: string,
    private readonly solanaClient: SolanaClient,
    private readonly logger: Logger
  ) {
    this.initCoder();
  }

  private initCoder(): void {
    try {
      const adaptedIdl = adaptIdlForCoder(this.idl.raw);
      this.coder = new BorshCoder(adaptedIdl as any);

      for (const acc of this.idl.accounts) {
        if (acc.discriminator) {
          const key = Buffer.from(acc.discriminator).toString('hex');
          this.discriminatorMap.set(key, acc);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to initialize BorshCoder for accounts');
    }
  }

  /**
   * Decode account states for a set of account addresses.
   * Filters to only program-owned accounts and attempts decoding.
   */
  async decodeAccounts(accountAddresses: string[]): Promise<DecodedAccountState[]> {
    if (accountAddresses.length === 0 || !this.coder) return [];

    const results: DecodedAccountState[] = [];
    const pubkeys = accountAddresses.map((a) => new PublicKey(a));

    // Fetch accounts in batches of 100
    for (let i = 0; i < pubkeys.length; i += 100) {
      const batch = pubkeys.slice(i, i + 100);
      const addresses = accountAddresses.slice(i, i + 100);

      try {
        const infos = await this.solanaClient.getMultipleAccountsInfo(batch);

        for (let j = 0; j < infos.length; j++) {
          const info = infos[j];
          if (!info) continue;

          // Only decode accounts owned by our program
          if (info.owner.toBase58() !== this.programId) continue;

          const decoded = this.decodeAccountData(addresses[j], info.data);
          if (decoded) results.push(decoded);
        }
      } catch (err) {
        this.logger.warn({ err, batch: i }, 'Failed to fetch account batch');
      }
    }

    return results;
  }

  /** Decode a single account's data. */
  decodeAccountData(address: string, data: Buffer): DecodedAccountState | null {
    if (!this.coder || data.length < 8) return null;

    const dataHash = createHash('sha256').update(data).digest('hex').slice(0, 16);

    // Try discriminator-based matching
    const discHex = data.subarray(0, 8).toString('hex');
    const matchedAccount = this.discriminatorMap.get(discHex);

    if (matchedAccount) {
      try {
        const decoded = this.coder.accounts.decode(matchedAccount.name, data);
        return {
          accountAddress: address,
          accountType: matchedAccount.name,
          decodedData: this.serializeData(decoded),
          dataHash,
        };
      } catch (err) {
        this.logger.debug(
          { err, address, accountType: matchedAccount.name },
          'Discriminator matched but decode failed'
        );
      }
    }

    // Try all account types
    for (const acc of this.idl.accounts) {
      try {
        const decoded = this.coder.accounts.decode(acc.name, data);
        if (decoded) {
          return {
            accountAddress: address,
            accountType: acc.name,
            decodedData: this.serializeData(decoded),
            dataHash,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /** Collect unique writable account addresses from decoded instructions. */
  extractWritableAccounts(
    decodedInstructions: { accounts: { pubkey: string; isWritable: boolean }[] }[]
  ): string[] {
    const set = new Set<string>();
    for (const ix of decodedInstructions) {
      for (const acc of ix.accounts) {
        if (acc.isWritable) {
          set.add(acc.pubkey);
        }
      }
    }
    return Array.from(set);
  }

  private serializeData(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object') return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = this.serializeValue(value);
    }
    return result;
  }

  private serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      return Buffer.from(value).toString('hex');
    }
    if (typeof value === 'object' && 'toBase58' in (value as any)) {
      return (value as any).toBase58();
    }
    if (typeof value === 'object' && 'toString' in (value as any) && (value as any).toNumber) {
      return (value as any).toString();
    }
    if (Array.isArray(value)) return value.map((v) => this.serializeValue(v));
    if (typeof value === 'object') {
      return this.serializeData(value);
    }
    return String(value);
  }
}
