/**
 * @module api/ReindexTracker
 * Tracks reindex operation state for status reporting. Single instance shared across handlers.
 */

import type { ReindexStatus } from '@karmaniverous/jeeves-watcher-core';

/** Reindex status snapshot for API consumers (watcher-core's `GET /status` schema type). */
export type { ReindexStatus };

/**
 * Tracks the state of reindex operations.
 */
export class ReindexTracker {
  private _active = false;
  private _scope?: string;
  private _startedAt?: string;
  private _filesProcessed = 0;
  private _totalFiles = 0;

  /** Mark a reindex as started. */
  start(scope: string): void {
    this._active = true;
    this._scope = scope;
    this._startedAt = new Date().toISOString();
    this._filesProcessed = 0;
    this._totalFiles = 0;
  }

  /** Set the total number of files to process. */
  setTotal(total: number): void {
    this._totalFiles = total;
  }

  /** Increment the processed file count. */
  incrementProcessed(): void {
    this._filesProcessed++;
  }

  /** Mark the current reindex as complete. */
  complete(): void {
    this._active = false;
    this._scope = undefined;
    this._startedAt = undefined;
    this._filesProcessed = 0;
    this._totalFiles = 0;
  }

  /** Get current reindex status. */
  getStatus(): ReindexStatus {
    if (!this._active) return { active: false };
    return {
      active: true,
      scope: this._scope,
      startedAt: this._startedAt,
      filesProcessed: this._filesProcessed,
      totalFiles: this._totalFiles,
    };
  }
}
