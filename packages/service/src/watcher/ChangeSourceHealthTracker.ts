/**
 * @module watcher/ChangeSourceHealthTracker
 * `health.changeSource` (D133, D157): counters since start, owned by the app so they survive watcher rebuilds. Pure.
 */

import type { ChangeSourceHealth } from '@karmaniverous/jeeves-watcher-core';

/**
 * Counts and timestamps behind `health.changeSource`. Never holds a path in
 * its snapshot (D89).
 */
export class ChangeSourceHealthTracker {
  private source: ChangeSourceHealth['source'] = 'chokidar';
  private resubscribes = 0;
  private renewFailures = 0;
  private reconcileEvents = 0;
  private reconcileErrors = 0;
  private lastReconcileAt: string | null = null;
  private lastReconcileDurationMs: number | null = null;
  private lastRenewDurationMs: number | null = null;
  private readonly unavailable = new Set<string>();
  private pendingStability: () => number = () => 0;

  /** Record the running source and its pending-stability reader. */
  attach(source: ChangeSourceHealth['source'], pending: () => number): void {
    this.source = source;
    this.pendingStability = pending;
    this.unavailable.clear();
  }

  /** A subscription was re-created after an error (D131). */
  recordResubscribe(): void {
    this.resubscribes++;
  }

  /**
   * A renewal forced a source rebuild (D165), or rejected inside one
   * (D176).
   *
   * @param count - Failures to add (default 1).
   */
  recordRenewFailure(count = 1): void {
    this.renewFailures += count;
  }

  /** A subscription renewal finished (Linux parcel, D129, D157). */
  recordRenew(durationMs: number): void {
    this.lastRenewDurationMs = durationMs;
  }

  /** Mark a root unavailable (D109) or available again. */
  setUnavailable(root: string, unavailable: boolean): void {
    if (unavailable) this.unavailable.add(root);
    else this.unavailable.delete(root);
  }

  /** Synthetic events a reconcile emitted (D90). */
  recordReconcileEvents(count: number): void {
    this.reconcileEvents += count;
  }

  /** A reconcile finished (walk and compare). */
  recordReconcile(durationMs: number, at: Date): void {
    this.lastReconcileDurationMs = durationMs;
    this.lastReconcileAt = at.toISOString();
  }

  /** A reconcile errored and emitted nothing (D90). */
  recordReconcileError(): void {
    this.reconcileErrors++;
  }

  /** The `health.changeSource` body. */
  snapshot(): ChangeSourceHealth {
    return {
      source: this.source,
      resubscribes: this.resubscribes,
      unavailableRoots: this.unavailable.size,
      reconcileEvents: this.reconcileEvents,
      reconcileErrors: this.reconcileErrors,
      lastReconcileAt: this.lastReconcileAt,
      lastReconcileDurationMs: this.lastReconcileDurationMs,
      pendingStability: this.pendingStability(),
      // Only Linux parcel renews (D129); chokidar and Windows stay null (D177).
      lastRenewDurationMs: this.lastRenewDurationMs,
      renewFailures: this.renewFailures,
    };
  }
}
