/**
 * @module vcs/RootBreaker
 * A root's commit circuit breaker with its retry timer and log lines (#249): admits or holds back an attempt, records outcomes, and wakes the queue when the cooldown elapses. Timers only; no git.
 */

import type pino from 'pino';

import {
  type CircuitBreakerSnapshot,
  CommitCircuitBreaker,
} from './CommitCircuitBreaker';

/** Breaker settings (from the root's VCS config). */
export interface RootBreakerConfig {
  /** Failures that trip the breaker. */
  maxConsecutiveFailures: number;
  /** Cooldown before one half-open attempt. */
  circuitBreakerCooldownMs: number;
}

/** The commit circuit breaker of one root. */
export class RootBreaker {
  private readonly breaker: CommitCircuitBreaker;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param root - Repository root (for logs).
   * @param logger - Logger.
   * @param config - Thresholds.
   * @param retryNow - Flushes the queue when a cooldown elapses.
   * @param isActive - Whether the manager is running (no timer otherwise).
   */
  constructor(
    private readonly root: string,
    private readonly logger: pino.Logger,
    private readonly config: RootBreakerConfig,
    private readonly retryNow: () => void,
    private readonly isActive: () => boolean,
  ) {
    this.breaker = new CommitCircuitBreaker(
      config.maxConsecutiveFailures,
      config.circuitBreakerCooldownMs,
    );
  }

  /** First trip since the last success (see `CommitCircuitBreaker`). */
  trippedSince(): string | null {
    return this.breaker.trippedSince();
  }

  /** Current state for status reporting. */
  snapshot(): CircuitBreakerSnapshot {
    return this.breaker.snapshot();
  }

  /**
   * Whether an attempt may run now. While cooling down it schedules the
   * retry and answers false; once the cooldown elapsed it logs the
   * half-open attempt and answers true.
   */
  admit(): boolean {
    if (!this.breaker.isTripped) return true;
    if (this.breaker.remainingCooldownMs() > 0) {
      this.scheduleRetry();
      return false;
    }
    this.logger.info(
      { root: this.root },
      'VCS circuit breaker half-open — attempting recovery commit',
    );
    return true;
  }

  /** Record a success (a commit or a no-op). */
  succeeded(): void {
    if (!this.breaker.recordSuccess()) return;
    this.stop();
    this.logger.info(
      { root: this.root },
      'VCS circuit breaker recovered — resuming normal operation',
    );
  }

  /**
   * Record a failure.
   *
   * @param message - The failure message.
   * @param pendingCount - Files waiting (for the trip log line).
   * @returns true if the breaker tripped (the retry timer is then set).
   */
  failed(message: string, pendingCount: number): boolean {
    if (!this.breaker.recordFailure(message)) return false;
    this.logger.error(
      {
        root: this.root,
        consecutiveFailures: this.breaker.snapshot().consecutiveFailures,
        pendingCount,
        cooldownMs: this.config.circuitBreakerCooldownMs,
      },
      'VCS circuit breaker tripped — pending files retained, will retry after cooldown',
    );
    this.scheduleRetry();
    return true;
  }

  /** Cancel the retry timer. */
  stop(): void {
    if (this.retryTimer === undefined) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /**
   * Ensure a timer flushes pending files when the cooldown elapses,
   * without needing a new file-change event.
   */
  private scheduleRetry(): void {
    if (!this.isActive() || this.retryTimer !== undefined) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retryNow();
    }, this.breaker.remainingCooldownMs());
  }
}
