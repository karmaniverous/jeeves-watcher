/**
 * @module api/ReindexTracker
 * Tracks reindex operation state for status reporting. Single instance shared across handlers.
 */

/** Reindex status snapshot for API consumers. */
export interface ReindexStatus {
  /** Whether a reindex operation is currently in progress. */
  active: boolean;
  /** The active reindex scope (when {@link active} is true). */
  scope?: string;
  /** ISO 8601 timestamp when the current reindex started (when {@link active} is true). */
  startedAt?: string;
}

/**
 * Tracks the state of reindex operations.
 */
export class ReindexTracker {
  private _active = false;
  private _scope?: string;
  private _startedAt?: string;

  /** Mark a reindex as started. */
  start(scope: 'rules' | 'full'): void {
    this._active = true;
    this._scope = scope;
    this._startedAt = new Date().toISOString();
  }

  /** Mark the current reindex as complete. */
  complete(): void {
    this._active = false;
    this._scope = undefined;
    this._startedAt = undefined;
  }

  /** Get current reindex status. */
  getStatus(): ReindexStatus {
    if (!this._active) return { active: false };
    return {
      active: true,
      scope: this._scope,
      startedAt: this._startedAt,
    };
  }
}
