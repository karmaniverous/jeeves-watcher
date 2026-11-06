/**
 * @module watcher/indexCheck/IndexCheckHealthTracker
 * `health.indexCheck` (D197): the state of the index check at start and its counts, owned by the app for the whole process. Never holds a path (D89). Pure.
 */

import type {
  IndexCheckHealth,
  IndexCheckState,
} from '@karmaniverous/jeeves-watcher-core';

/** What one finished check counted. */
export interface IndexCheckCounts {
  /** File documents compared with the inventory. */
  checked: number;
  /** Documents deleted. */
  removed: number;
  /** Roots not checked. */
  skippedRoots: number;
  /** Roots over the cap. */
  capped: number;
}

/** State and counts behind `health.indexCheck`. */
export class IndexCheckHealthTracker {
  private state: IndexCheckState = 'pending';
  private startedAt: number | null = null;
  private at: string | null = null;
  private durationMs: number | null = null;
  private counts: IndexCheckCounts = {
    checked: 0,
    removed: 0,
    skippedRoots: 0,
    capped: 0,
  };

  /** `watch.indexCheckOnStart` is false: the check never runs. */
  off(): void {
    this.state = 'off';
  }

  /** The check started. */
  start(now: Date = new Date()): void {
    this.state = 'running';
    this.startedAt = now.getTime();
  }

  /**
   * The check ended.
   *
   * @param state - `done`, or `failed` when the index could not be listed.
   * @param counts - What it counted (on failure: what it had counted).
   * @param now - When it ended.
   */
  finish(
    state: 'done' | 'failed',
    counts: IndexCheckCounts,
    now: Date = new Date(),
  ): void {
    this.state = state;
    this.counts = { ...counts };
    this.at = now.toISOString();
    this.durationMs =
      this.startedAt === null ? 0 : now.getTime() - this.startedAt;
  }

  /** The `health.indexCheck` body. */
  snapshot(): IndexCheckHealth {
    return {
      state: this.state,
      at: this.at,
      durationMs: this.durationMs,
      ...this.counts,
    };
  }
}
