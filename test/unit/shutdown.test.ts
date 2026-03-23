import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { GracefulShutdown } from '../../src/shutdown/shutdown.js';

const logger = pino({ level: 'silent' });

describe('GracefulShutdown', () => {
  it('should register and execute cleanup functions', async () => {
    const shutdown = new GracefulShutdown(logger);
    const order: string[] = [];

    shutdown.register('first', async () => { order.push('first'); });
    shutdown.register('second', async () => { order.push('second'); });
    shutdown.register('third', async () => { order.push('third'); });

    await shutdown.shutdown();

    // LIFO order
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('should set isShuttingDown flag', async () => {
    const shutdown = new GracefulShutdown(logger);
    expect(shutdown.isShuttingDown).toBe(false);

    const promise = shutdown.shutdown();
    expect(shutdown.isShuttingDown).toBe(true);

    await promise;
  });

  it('should handle cleanup errors gracefully', async () => {
    const shutdown = new GracefulShutdown(logger);
    const order: string[] = [];

    shutdown.register('good', async () => { order.push('good'); });
    shutdown.register('bad', async () => { throw new Error('fail'); });
    shutdown.register('also-good', async () => { order.push('also-good'); });

    await shutdown.shutdown();

    // Should continue despite error
    expect(order).toEqual(['also-good', 'good']);
  });

  it('should be idempotent', async () => {
    const shutdown = new GracefulShutdown(logger);
    let count = 0;

    shutdown.register('counter', async () => { count++; });

    await shutdown.shutdown();
    await shutdown.shutdown();

    expect(count).toBe(1);
  });
});
