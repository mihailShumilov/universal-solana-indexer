import type { Logger } from '../logger/index.js';

type CleanupFn = () => Promise<void>;

/**
 * Manages graceful shutdown on SIGINT/SIGTERM.
 *
 * Registers cleanup functions and executes them in reverse order on signal.
 * Provides an `isShuttingDown` flag for indexer loops to check.
 */
export class GracefulShutdown {
  private cleanups: { name: string; fn: CleanupFn }[] = [];
  private _isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly logger: Logger) {
    const handler = (signal: string) => {
      this.logger.info({ signal }, 'Shutdown signal received');
      this.shutdown();
    };
    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /** Register a cleanup function to run on shutdown. */
  register(name: string, fn: CleanupFn): void {
    this.cleanups.push({ name, fn });
  }

  /** Trigger shutdown. Safe to call multiple times. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this._isShuttingDown = true;
    this.shutdownPromise = this.executeCleanups();
    return this.shutdownPromise;
  }

  /** Wait for shutdown to complete, then exit. */
  async waitAndExit(code: number = 0): Promise<never> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
    }
    process.exit(code);
  }

  private async executeCleanups(): Promise<void> {
    this.logger.info('Starting graceful shutdown...');

    // Execute in reverse registration order (LIFO)
    const reversed = [...this.cleanups].reverse();
    for (const { name, fn } of reversed) {
      try {
        this.logger.info({ step: name }, 'Cleanup step running');
        await Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Cleanup timeout: ${name}`)), 10000)
          ),
        ]);
        this.logger.info({ step: name }, 'Cleanup step completed');
      } catch (err) {
        this.logger.error({ err, step: name }, 'Cleanup step failed');
      }
    }

    this.logger.info('Graceful shutdown complete');
  }
}
