import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configSchema } from '../../src/config/schema.js';

describe('Config validation', () => {
  const validConfig = {
    nodeEnv: 'development',
    port: 3000,
    logLevel: 'info',
    databaseUrl: 'postgresql://user:pass@localhost:5432/db',
    solanaRpcHttpUrl: 'https://api.mainnet-beta.solana.com',
    solanaRpcWsUrl: 'wss://api.mainnet-beta.solana.com',
    solanaProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    idlSourceType: 'file',
    idlFilePath: './idl/test.json',
    indexerMode: 'batch',
    batchStartSlot: '100',
    batchEndSlot: '200',
  };

  it('should accept valid configuration', () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should reject missing database URL', () => {
    const { databaseUrl, ...rest } = validConfig;
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject invalid database URL', () => {
    const result = configSchema.safeParse({ ...validConfig, databaseUrl: 'mysql://...' });
    expect(result.success).toBe(false);
  });

  it('should require IDL_FILE_PATH when IDL_SOURCE_TYPE is file', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      idlSourceType: 'file',
      idlFilePath: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('should require IDL_ACCOUNT_ADDRESS when IDL_SOURCE_TYPE is onchain', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      idlSourceType: 'onchain',
      idlAccountAddress: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('should require batch params in batch mode', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      indexerMode: 'batch',
      batchStartSlot: undefined,
      batchEndSlot: undefined,
      batchSignatures: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('should accept batch mode with signatures', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      batchStartSlot: undefined,
      batchEndSlot: undefined,
      batchSignatures: 'sig1,sig2,sig3',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchSignatures).toEqual(['sig1', 'sig2', 'sig3']);
    }
  });

  it('should reject batchStartSlot > batchEndSlot', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      batchStartSlot: '300',
      batchEndSlot: '200',
    });
    expect(result.success).toBe(false);
  });

  it('should coerce numeric string values', () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.port).toBe('number');
      expect(result.data.port).toBe(3000);
    }
  });

  it('should apply defaults', () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchSize).toBe(50);
      expect(result.data.rpcMaxRetries).toBe(5);
      expect(result.data.pageSizeDefault).toBe(50);
    }
  });

  it('should not require batch params in realtime mode', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      indexerMode: 'realtime',
      batchStartSlot: undefined,
      batchEndSlot: undefined,
    });
    expect(result.success).toBe(true);
  });
});
