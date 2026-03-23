import type { Logger } from '../logger/index.js';

export interface RetryOptions {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitter?: boolean;
  retryableErrors?: (err: unknown) => boolean;
  logger?: Logger;
  label?: string;
}

const DEFAULT_OPTIONS: Partial<RetryOptions> = {
  jitter: true,
};

/** Returns true if the error is likely transient and retryable. */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Rate limits, timeouts, server errors
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('timeout') || msg.includes('timed out')) return true;
    if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
    if (msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry.
 *
 * Delay formula: min(initialBackoff * 2^attempt, maxBackoff) + optional jitter
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const shouldRetry = opts.retryableErrors || isRetryable;

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= opts.maxRetries || !shouldRetry(err)) {
        opts.logger?.error(
          { err, attempt, label: opts.label },
          `Retry exhausted after ${attempt + 1} attempts`
        );
        throw err;
      }

      const baseDelay = Math.min(
        opts.initialBackoffMs * Math.pow(2, attempt),
        opts.maxBackoffMs
      );
      const jitter = opts.jitter ? Math.random() * baseDelay * 0.3 : 0;
      const delay = Math.round(baseDelay + jitter);

      opts.logger?.warn(
        { attempt: attempt + 1, maxRetries: opts.maxRetries, delayMs: delay, label: opts.label },
        'Retrying after transient error'
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
