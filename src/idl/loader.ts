import type { AppConfig } from '../config/index.js';
import type { Logger } from '../logger/index.js';
import { FileIdlSource } from './file-source.js';
import { OnChainIdlSource } from './onchain-source.js';
import { normalizeIdl, type NormalizedIdl } from './normalizer.js';
import type { IdlSource } from './types.js';

export async function loadIdl(config: AppConfig, logger: Logger): Promise<NormalizedIdl> {
  let source: IdlSource;

  if (config.idlSourceType === 'file') {
    logger.info({ path: config.idlFilePath }, 'Loading IDL from file');
    source = new FileIdlSource(config.idlFilePath!);
  } else {
    logger.info({ address: config.idlAccountAddress }, 'Loading IDL from on-chain account');
    source = new OnChainIdlSource(config.solanaRpcHttpUrl, config.idlAccountAddress!);
  }

  const rawIdl = await source.load();
  const normalized = normalizeIdl(rawIdl);

  logger.info(
    {
      name: normalized.name,
      version: normalized.version,
      instructions: normalized.instructions.length,
      accounts: normalized.accounts.length,
    },
    'IDL loaded and normalized'
  );

  return normalized;
}
