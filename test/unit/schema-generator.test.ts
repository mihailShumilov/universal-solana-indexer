import { describe, it, expect, vi } from 'vitest';
import { normalizeIdl } from '../../src/idl/normalizer.js';
import sampleIdl from '../fixtures/sample-idl.json';
import tokenIdl from '../fixtures/token-idl.json';
import type { AnchorIdl } from '../../src/idl/types.js';

describe('Schema generation from IDL', () => {
  it('should generate metadata entries for all instructions in counter IDL', () => {
    const idl = normalizeIdl(sampleIdl as AnchorIdl);

    // Verify instructions have the expected structure
    expect(idl.instructions).toHaveLength(4);
    for (const ix of idl.instructions) {
      expect(ix.name).toBeTruthy();
      expect(ix.accounts).toBeDefined();
      expect(ix.args).toBeDefined();
    }
  });

  it('should generate metadata entries for all accounts in counter IDL', () => {
    const idl = normalizeIdl(sampleIdl as AnchorIdl);

    expect(idl.accounts).toHaveLength(1);
    const counter = idl.accounts[0];
    expect(counter.name).toBe('counter');
    expect(counter.fields.length).toBeGreaterThan(0);
  });

  it('should generate metadata for token vault IDL', () => {
    const idl = normalizeIdl(tokenIdl as AnchorIdl);

    expect(idl.instructions).toHaveLength(3);
    expect(idl.accounts).toHaveLength(1);

    const vault = idl.accounts[0];
    expect(vault.fields.length).toBeGreaterThan(0);
    expect(vault.fields.find((f) => f.name === 'depositors')).toBeDefined();
  });

  it('should handle IDLs with different instruction shapes', () => {
    const counterIdl = normalizeIdl(sampleIdl as AnchorIdl);
    const tokenIdlN = normalizeIdl(tokenIdl as AnchorIdl);

    // Both should produce valid normalized structures
    expect(counterIdl.instructions.every((ix) => ix.name && ix.accounts)).toBe(true);
    expect(tokenIdlN.instructions.every((ix) => ix.name && ix.accounts)).toBe(true);
  });

  it('should preserve discriminators when present', () => {
    const idl = normalizeIdl(sampleIdl as AnchorIdl);

    const withDisc = idl.instructions.filter((ix) => ix.discriminator !== null);
    expect(withDisc.length).toBeGreaterThan(0);

    for (const ix of withDisc) {
      expect(ix.discriminator).toBeInstanceOf(Array);
      expect(ix.discriminator!.length).toBe(8);
    }
  });
});
