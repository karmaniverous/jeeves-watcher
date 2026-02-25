/**
 * @module health
 * Tracks consecutive system-level failures and applies exponential backoff.
 * Triggers fatal error callback when maxRetries is exceeded.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';

/**
 * Options for {@link SystemHealth}.
 */
export interface SystemHealthOptions {
  /** Maximum consecutive failures before fatal. Default: Infinity. */
  maxRetries?: number;
  /** Maximum backoff delay in milliseconds. Default: 60000. */
  maxBackoffMs?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  baseDelayMs?: number;
  /** Called when maxRetries is exceeded. If not set, throws. */
  onFatalError?: (error: unknown) => void;
  /** Logger instance. */
  logger: pino.Logger;
}

/**
 * Tracks system health via consecutive failure count and exponential backoff.
 */
export class SystemHealth {
  private consecutiveFailures = 0;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly baseDelayMs: number;
  private readonly onFatalError?: (error: unknown) => void;
  private readonly logger: pino.Logger;

  constructor(options: SystemHealthOptions) {
    this.maxRetries = options.maxRetries ?? Number.POSITIVE_INFINITY;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.onFatalError = options.onFatalError;
    this.logger = options.logger;
  }

  /**
   * Record a successful system operation. Resets the failure counter.
   */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.logger.info(
        { previousFailures: this.consecutiveFailures },
        'System health recovered',
      );
    }
    this.consecutiveFailures = 0;
  }

  /**
   * Record a system-level failure. If maxRetries is exceeded, triggers fatal error.
   *
   * @param error - The error that occurred.
   * @returns Whether the watcher should continue (false = fatal).
   */
  recordFailure(error: unknown): boolean {
    this.consecutiveFailures += 1;

    this.logger.error(
      {
        consecutiveFailures: this.consecutiveFailures,
        maxRetries: this.maxRetries,
        err: normalizeError(error),
      },
      'System-level failure recorded',
    );

    if (this.consecutiveFailures >= this.maxRetries) {
      this.logger.fatal(
        { consecutiveFailures: this.consecutiveFailures },
        'Maximum retries exceeded, triggering fatal error',
      );

      if (this.onFatalError) {
        this.onFatalError(error);
        return false;
      }

      throw error instanceof Error
        ? error
        : new Error(`Fatal system error: ${String(error)}`);
    }

    return true;
  }

  /**
   * Compute the current backoff delay based on consecutive failures.
   *
   * @returns Delay in milliseconds.
   */
  get currentBackoffMs(): number {
    if (this.consecutiveFailures === 0) return 0;
    const exp = Math.max(0, this.consecutiveFailures - 1);
    return Math.min(this.maxBackoffMs, this.baseDelayMs * 2 ** exp);
  }

  /**
   * Sleep for the current backoff duration.
   *
   * @param signal - Optional abort signal.
   */
  async backoff(signal?: AbortSignal): Promise<void> {
    const delay = this.currentBackoffMs;
    if (delay <= 0) return;

    this.logger.warn(
      { delayMs: delay, consecutiveFailures: this.consecutiveFailures },
      'Backing off before next attempt',
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);

      const onAbort = () => {
        cleanup();
        reject(new Error('Backoff aborted'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** Current consecutive failure count. */
  get failures(): number {
    return this.consecutiveFailures;
  }
}
