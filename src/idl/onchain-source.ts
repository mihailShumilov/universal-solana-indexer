import { Connection, PublicKey } from '@solana/web3.js';
import { inflate } from 'zlib';
import { promisify } from 'util';
import type { AnchorIdl, IdlSource } from './types.js';

const inflateAsync = promisify(inflate);

/**
 * Loads an Anchor IDL from an on-chain IDL account.
 *
 * Anchor stores IDLs in accounts derived from the program ID.
 * The account data starts with an 8-byte discriminator + 4-byte authority,
 * followed by a 4-byte length prefix and zlib-compressed JSON.
 */
export class OnChainIdlSource implements IdlSource {
  constructor(
    private readonly rpcUrl: string,
    private readonly idlAccountAddress: string
  ) {}

  async load(): Promise<AnchorIdl> {
    const connection = new Connection(this.rpcUrl, 'confirmed');
    const pubkey = new PublicKey(this.idlAccountAddress);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo || !accountInfo.data) {
      throw new Error(`IDL account not found at ${this.idlAccountAddress}`);
    }

    const data = accountInfo.data;

    // Anchor IDL accounts: 8 bytes discriminator + 4 bytes authority offset
    // then compressed IDL data. Try multiple offset strategies.
    const offsets = [44, 12, 8]; // Common Anchor IDL data offsets
    let idlJson: string | null = null;

    for (const offset of offsets) {
      try {
        const compressedData = data.subarray(offset);
        const decompressed = await inflateAsync(compressedData);
        idlJson = decompressed.toString('utf-8');
        JSON.parse(idlJson); // validate
        break;
      } catch {
        continue;
      }
    }

    if (!idlJson) {
      // Try uncompressed
      try {
        const rawStr = data.subarray(8).toString('utf-8');
        const startIdx = rawStr.indexOf('{');
        if (startIdx >= 0) {
          idlJson = rawStr.substring(startIdx);
          JSON.parse(idlJson);
        }
      } catch {
        throw new Error('Failed to decode IDL account data — unsupported format');
      }
    }

    if (!idlJson) {
      throw new Error('Failed to decode IDL account data');
    }

    const parsed = JSON.parse(idlJson);
    if (!parsed.instructions || !Array.isArray(parsed.instructions)) {
      throw new Error('Decoded IDL is missing "instructions" array');
    }

    return parsed;
  }
}
