/**
 * @module vcs/CommitCircuitBreaker
 * Per-root circuit breaker for the VCS commit pipeline. Counts consecutive
 * failures, trips at a threshold, and allows one half-open attempt per
 * cooldown. It holds no files: callers retain pending work while it is
 * tripped. See #249.
 */

/** Serializable breaker state. */
export interface CircuitBreakerSnapshot {
  /** Consecutive commit failures since the last success. */
  consecutiveFailures: number;
  /** Whether the breaker is tripped. */
  tripped: boolean;
  /** ISO timestamp of the current trip, or null. */
  trippedAt: string | null;
  /** Message of the most recent failure, or null. */
  lastError: string | null;
}

/** Circuit breaker with a time-based half-open recovery. */
export class CommitCircuitBreaker {
  private failures = 0;
  private trippedAtMs: number | undefined;
  private firstTrippedAtMs: number | undefined;
  private lastError: string | undefined;

  /**
   * @param maxConsecutiveFailures - Failures that trip the breaker.
   * @param cooldownMs - Time after a trip before one attempt is allowed.
   * @param now - Clock (injectable for tests).
   */
  constructor(
    private readonly maxConsecutiveFailures: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether the breaker is tripped. */
  get isTripped(): boolean {
    return this.trippedAtMs !== undefined;
  }

  /**
   * Milliseconds until an attempt is allowed. 0 when not tripped or when
   * the cooldown has elapsed (half-open).
   */
  remainingCooldownMs(): number {
    if (this.trippedAtMs === undefined) return 0;
    return Math.max(0, this.cooldownMs - (this.now() - this.trippedAtMs));
  }

  /**
   * Record a failed attempt.
   *
   * @param message - The failure message.
   * @returns true if this failure tripped (or re-armed) the breaker.
   */
  recordFailure(message: string): boolean {
    this.failures++;
    this.lastError = message;
    if (this.failures < this.maxConsecutiveFailures) return false;
    this.trippedAtMs = this.now();
    this.firstTrippedAtMs ??= this.trippedAtMs;
    return true;
  }

  /**
   * Record a successful attempt (a commit or a no-op) and reset.
   *
   * @returns true if the breaker was tripped before this success.
   */
  recordSuccess(): boolean {
    const wasTripped = this.isTripped;
    this.failures = 0;
    this.trippedAtMs = undefined;
    this.firstTrippedAtMs = undefined;
    this.lastError = undefined;
    return wasTripped;
  }

  /**
   * ISO time of the first trip since the last success (a failed half-open
   * attempt re-arms the cooldown but does not move it), or null.
   */
  trippedSince(): string | null {
    return this.firstTrippedAtMs === undefined
      ? null
      : new Date(this.firstTrippedAtMs).toISOString();
  }

  /** Current state for status reporting. */
  snapshot(): CircuitBreakerSnapshot {
    return {
      consecutiveFailures: this.failures,
      tripped: this.isTripped,
      trippedAt:
        this.trippedAtMs === undefined
          ? null
          : new Date(this.trippedAtMs).toISOString(),
      lastError: this.lastError ?? null,
    };
  }
}
