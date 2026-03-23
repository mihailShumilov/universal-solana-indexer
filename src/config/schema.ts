import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

export const configSchema = z
  .object({
    // Application
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    port: z.coerce.number().int().min(1).max(65535).default(3000),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Database
    databaseUrl: z.string().url().startsWith('postgresql://'),

    // Solana RPC
    solanaRpcHttpUrl: z.string().url(),
    solanaRpcWsUrl: z.string().startsWith('wss://').or(z.string().startsWith('ws://')),
    solanaProgramId: z.string().min(32).max(44),

    // IDL Source
    idlSourceType: z.enum(['file', 'onchain']),
    idlFilePath: z.string().optional(),
    idlAccountAddress: z.string().optional(),

    // Indexer Mode
    indexerMode: z.enum(['batch', 'realtime']),

    // Batch Config
    batchStartSlot: nonNegativeInt.optional(),
    batchEndSlot: nonNegativeInt.optional(),
    batchSignatures: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
    batchSize: positiveInt.default(50),

    // Realtime Config
    realtimeConfirmation: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
    backfillEnabled: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),

    // Retry / Backoff
    rpcMaxRetries: positiveInt.default(5),
    rpcInitialBackoffMs: positiveInt.default(500),
    rpcMaxBackoffMs: positiveInt.default(30000),

    // Checkpoint
    checkpointCommitInterval: positiveInt.default(100),

    // API Pagination
    pageSizeDefault: positiveInt.default(50),
    pageSizeMax: positiveInt.default(500),
  })
  .superRefine((data, ctx) => {
    if (data.idlSourceType === 'file' && !data.idlFilePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'IDL_FILE_PATH is required when IDL_SOURCE_TYPE is "file"',
        path: ['idlFilePath'],
      });
    }
    if (data.idlSourceType === 'onchain' && !data.idlAccountAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'IDL_ACCOUNT_ADDRESS is required when IDL_SOURCE_TYPE is "onchain"',
        path: ['idlAccountAddress'],
      });
    }
    if (data.indexerMode === 'batch') {
      const hasSlotRange = data.batchStartSlot !== undefined && data.batchEndSlot !== undefined;
      const hasSignatures = data.batchSignatures && data.batchSignatures.length > 0;
      if (!hasSlotRange && !hasSignatures) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Batch mode requires either BATCH_START_SLOT + BATCH_END_SLOT or BATCH_SIGNATURES',
          path: ['batchStartSlot'],
        });
      }
      if (
        hasSlotRange &&
        data.batchStartSlot !== undefined &&
        data.batchEndSlot !== undefined &&
        data.batchStartSlot > data.batchEndSlot
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'BATCH_START_SLOT must be <= BATCH_END_SLOT',
          path: ['batchStartSlot'],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
