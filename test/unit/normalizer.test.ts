import { describe, it, expect } from 'vitest';
import { normalizeIdl, typeToString } from '../../src/idl/normalizer.js';
import sampleIdl from '../fixtures/sample-idl.json';
import tokenIdl from '../fixtures/token-idl.json';
import type { AnchorIdl } from '../../src/idl/types.js';

describe('IDL Normalizer', () => {
  describe('normalizeIdl', () => {
    it('should normalize sample counter IDL', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);

      expect(result.name).toBe('counter_program');
      expect(result.version).toBe('0.1.0');
      expect(result.instructions).toHaveLength(4);
      expect(result.accounts).toHaveLength(1);
    });

    it('should normalize instruction accounts with isMut/isSigner', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);
      const initIx = result.instructions.find((ix) => ix.name === 'initialize');

      expect(initIx).toBeDefined();
      expect(initIx!.accounts).toHaveLength(3);

      const counterAcc = initIx!.accounts.find((a) => a.name === 'counter');
      expect(counterAcc).toBeDefined();
      expect(counterAcc!.isMut).toBe(true);
      expect(counterAcc!.isSigner).toBe(false);

      const authorityAcc = initIx!.accounts.find((a) => a.name === 'authority');
      expect(authorityAcc).toBeDefined();
      expect(authorityAcc!.isMut).toBe(true);
      expect(authorityAcc!.isSigner).toBe(true);
    });

    it('should normalize instruction args', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);
      const initIx = result.instructions.find((ix) => ix.name === 'initialize');

      expect(initIx!.args).toHaveLength(1);
      expect(initIx!.args[0].name).toBe('initialValue');
      expect(initIx!.args[0].type).toBe('u64');
    });

    it('should normalize accounts with fields', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);
      const counter = result.accounts[0];

      expect(counter.name).toBe('counter');
      expect(counter.fields).toHaveLength(4);
      expect(counter.fields.map((f) => f.name)).toContain('authority');
      expect(counter.fields.map((f) => f.name)).toContain('count');
    });

    it('should handle discriminators', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);
      const initIx = result.instructions.find((ix) => ix.name === 'initialize');

      expect(initIx!.discriminator).toEqual([175, 175, 109, 31, 13, 152, 155, 237]);
    });

    it('should normalize token vault IDL with writable/signer format', () => {
      const result = normalizeIdl(tokenIdl as AnchorIdl);

      expect(result.name).toBe('token_vault');
      expect(result.instructions).toHaveLength(3);

      const createVault = result.instructions.find((ix) => ix.name === 'createVault');
      expect(createVault).toBeDefined();
      expect(createVault!.accounts[0].isMut).toBe(true);
      expect(createVault!.accounts[1].isSigner).toBe(true);
    });

    it('should normalize complex field types', () => {
      const result = normalizeIdl(tokenIdl as AnchorIdl);
      const vault = result.accounts[0];

      const depositorsField = vault.fields.find((f) => f.name === 'depositors');
      expect(depositorsField).toBeDefined();
      expect(depositorsField!.type).toBe('vec<publicKey>');
    });

    it('should populate types map', () => {
      const result = normalizeIdl(sampleIdl as AnchorIdl);
      expect(result.types.has('CounterEvent')).toBe(true);
    });
  });

  describe('typeToString', () => {
    it('should handle simple types', () => {
      expect(typeToString('u64')).toBe('u64');
      expect(typeToString('publicKey')).toBe('publicKey');
    });

    it('should handle vec types', () => {
      expect(typeToString({ vec: 'publicKey' })).toBe('vec<publicKey>');
    });

    it('should handle option types', () => {
      expect(typeToString({ option: 'string' })).toBe('option<string>');
    });

    it('should handle array types', () => {
      expect(typeToString({ array: ['u8', 32] })).toBe('array<u8, 32>');
    });

    it('should handle defined types', () => {
      expect(typeToString({ defined: 'MyStruct' })).toBe('defined<MyStruct>');
      expect(typeToString({ defined: { name: 'MyStruct' } })).toBe('defined<MyStruct>');
    });

    it('should handle nested types', () => {
      expect(typeToString({ vec: { option: 'u64' } })).toBe('vec<option<u64>>');
    });
  });
});
