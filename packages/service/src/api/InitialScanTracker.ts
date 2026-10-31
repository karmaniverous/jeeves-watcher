/**
 * @module api/InitialScanTracker
 * Tracks initial filesystem scan state for status reporting.
 */

import type { InitialScanStatus } from '@karmaniverous/jeeves-watcher-core';

/** Initial scan status snapshot for API consumers (watcher-core's `GET /status` schema type). */
export type { InitialScanStatus };

/**
 * Tracks the state of the initial filesystem scan after service start.
 */
export class InitialScanTracker {
  private _active = false;
  private _filesMatched = 0;
  private _filesEnqueued = 0;
  private _startedAt?: string;
  private _completedAt?: string;
  private _durationMs?: number;
  private _started = false;

  /** Mark the initial scan as started. */
  start(): void {
    this._active = true;
    this._started = true;
    this._startedAt = new Date().toISOString();
    this._filesMatched = 0;
    this._filesEnqueued = 0;
  }

  /** Set the total number of matched files. */
  setMatched(count: number): void {
    this._filesMatched = count;
  }

  /** Increment the processed file count. */
  incrementEnqueued(): void {
    this._filesEnqueued++;
  }

  /** Mark the scan as complete. */
  complete(): void {
    this._active = false;
    this._completedAt = new Date().toISOString();
    if (this._startedAt) {
      this._durationMs =
        new Date(this._completedAt).getTime() -
        new Date(this._startedAt).getTime();
    }
  }

  /** Get current scan status. */
  getStatus(): InitialScanStatus {
    if (!this._started) {
      return { active: false };
    }

    if (this._active) {
      return {
        active: true,
        filesMatched: this._filesMatched,
        filesEnqueued: this._filesEnqueued,
        startedAt: this._startedAt,
      };
    }

    return {
      active: false,
      filesMatched: this._filesMatched,
      filesEnqueued: this._filesEnqueued,
      completedAt: this._completedAt,
      durationMs: this._durationMs,
    };
  }
}
