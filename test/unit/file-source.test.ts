import { describe, it, expect } from 'vitest';
import { FileIdlSource } from '../../src/idl/file-source.js';
import path from 'path';

describe('FileIdlSource', () => {
  it('should load a valid IDL from file', async () => {
    const source = new FileIdlSource(path.join(__dirname, '../fixtures/sample-idl.json'));
    const idl = await source.load();

    expect(idl.name).toBe('counter_program');
    expect(idl.instructions).toHaveLength(4);
    expect(idl.accounts).toHaveLength(1);
  });

  it('should throw for non-existent file', async () => {
    const source = new FileIdlSource('/nonexistent/path.json');
    await expect(source.load()).rejects.toThrow();
  });

  it('should load token vault IDL', async () => {
    const source = new FileIdlSource(path.join(__dirname, '../fixtures/token-idl.json'));
    const idl = await source.load();

    expect(idl.name).toBe('token_vault');
    expect(idl.instructions).toHaveLength(3);
  });
});
