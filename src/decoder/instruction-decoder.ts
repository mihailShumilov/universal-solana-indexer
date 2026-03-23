import { BorshCoder } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import type { NormalizedIdl } from '../idl/normalizer.js';
import type { Logger } from '../logger/index.js';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';

export interface DecodedInstruction {
  name: string;
  instructionIndex: number;
  isInnerInstruction: boolean;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  decodedArgs: Record<string, unknown>;
  rawData: string;
}

/**
 * Decodes program instructions from parsed transactions using the Anchor IDL.
 *
 * Uses BorshCoder from @coral-xyz/anchor for deserialization.
 * Falls back to raw data if decoding fails.
 */
export class InstructionDecoder {
  private coder: BorshCoder | null = null;
  private readonly discriminatorMap: Map<string, string> = new Map();

  constructor(
    private readonly idl: NormalizedIdl,
    private readonly programId: string,
    private readonly logger: Logger
  ) {
    this.initCoder();
  }

  private initCoder(): void {
    try {
      this.coder = new BorshCoder(this.idl.raw as any);

      // Build discriminator map for fast lookup
      for (const ix of this.idl.instructions) {
        if (ix.discriminator) {
          const key = Buffer.from(ix.discriminator).toString('hex');
          this.discriminatorMap.set(key, ix.name);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to initialize BorshCoder, falling back to discriminator-only decoding');
    }
  }

  /**
   * Decode all program-relevant instructions from a parsed transaction.
   */
  decode(tx: ParsedTransactionWithMeta): DecodedInstruction[] {
    const results: DecodedInstruction[] = [];
    const message = tx.transaction.message;

    // Process outer instructions
    for (let idx = 0; idx < message.instructions.length; idx++) {
      const ix = message.instructions[idx];

      if ('programId' in ix && ix.programId.toBase58() === this.programId) {
        const decoded = this.decodeInstruction(ix, idx, false);
        if (decoded) results.push(decoded);
      }
    }

    // Process inner instructions
    if (tx.meta?.innerInstructions) {
      for (const inner of tx.meta.innerInstructions) {
        for (let j = 0; j < inner.instructions.length; j++) {
          const ix = inner.instructions[j];
          if ('programId' in ix && ix.programId.toBase58() === this.programId) {
            const decoded = this.decodeInstruction(ix, inner.index, true);
            if (decoded) results.push(decoded);
          }
        }
      }
    }

    return results;
  }

  private decodeInstruction(
    ix: any,
    index: number,
    isInner: boolean
  ): DecodedInstruction | null {
    try {
      // Extract raw data
      let rawData: string;
      let dataBuffer: Buffer;

      if ('data' in ix && typeof ix.data === 'string') {
        rawData = ix.data;
        try {
          dataBuffer = Buffer.from(bs58.decode(ix.data));
        } catch {
          dataBuffer = Buffer.from(ix.data, 'base64');
        }
      } else {
        return null;
      }

      // Extract accounts
      const accounts = (ix.accounts || ix.keys || []).map((acc: any) => {
        if (typeof acc === 'string') {
          return { pubkey: acc, isSigner: false, isWritable: false };
        }
        return {
          pubkey: acc.pubkey?.toBase58?.() || acc.pubkey || String(acc),
          isSigner: acc.isSigner ?? false,
          isWritable: acc.isWritable ?? false,
        };
      });

      // Try BorshCoder decoding first
      if (this.coder) {
        try {
          const decoded = this.coder.instruction.decode(dataBuffer);
          if (decoded) {
            return {
              name: decoded.name,
              instructionIndex: index,
              isInnerInstruction: isInner,
              accounts,
              decodedArgs: this.serializeArgs(decoded.data as Record<string, unknown>),
              rawData,
            };
          }
        } catch {
          // Fall through to discriminator matching
        }
      }

      // Fallback: discriminator matching
      if (dataBuffer.length >= 8) {
        const discHex = dataBuffer.subarray(0, 8).toString('hex');
        const ixName = this.discriminatorMap.get(discHex);
        if (ixName) {
          return {
            name: ixName,
            instructionIndex: index,
            isInnerInstruction: isInner,
            accounts,
            decodedArgs: { _raw: rawData, _note: 'BorshCoder failed, matched by discriminator only' },
            rawData,
          };
        }
      }

      // Unknown instruction for this program
      return {
        name: '_unknown',
        instructionIndex: index,
        isInnerInstruction: isInner,
        accounts,
        decodedArgs: { _raw: rawData },
        rawData,
      };
    } catch (err) {
      this.logger.debug({ err, index }, 'Failed to decode instruction');
      return null;
    }
  }

  /** Convert decoded args to plain JSON-safe objects. */
  private serializeArgs(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
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
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.serializeValue(v);
      }
      return result;
    }
    return String(value);
  }
}
