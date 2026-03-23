import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/retry/retry.js';

describe('Retry with exponential backoff', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, {
      maxRetries: 3,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
      jitter: false,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
      jitter: false,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        jitter: false,
      })
    ).rejects.toThrow('timeout');

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('should not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid argument'));

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
      })
    ).rejects.toThrow('invalid argument');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use custom retryable check', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('custom error'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxRetries: 2,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
      retryableErrors: (err) => err instanceof Error && err.message.includes('custom'),
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should respect exponential backoff timing', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, {
      maxRetries: 3,
      initialBackoffMs: 50,
      maxBackoffMs: 200,
      jitter: false,
    });
    const elapsed = Date.now() - start;

    // Should wait ~50ms + ~100ms = ~150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('should cap delay at maxBackoffMs', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, {
      maxRetries: 4,
      initialBackoffMs: 50,
      maxBackoffMs: 80,
      jitter: false,
    });
    const elapsed = Date.now() - start;

    // Delays: 50, 80, 80 = 210ms max
    expect(elapsed).toBeLessThan(500);
  });
});
