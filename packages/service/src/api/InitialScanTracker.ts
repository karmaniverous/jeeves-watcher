/**
 * @module api/InitialScanTracker
 * Tracks initial filesystem scan state for status reporting.
 */

/** Initial scan status snapshot for API consumers. */
export interface InitialScanStatus {
  /** Whether the initial scan is currently in progress. */
  active: boolean;
  /** Number of files matched by watch globs. */
  filesMatched?: number;
  /** Number of files enqueued for processing so far. */
  filesEnqueued?: number;
  /** ISO 8601 timestamp when the scan started. */
  startedAt?: string;
  /** ISO 8601 timestamp when the scan completed. */
  completedAt?: string;
  /** Total scan duration in milliseconds. */
  durationMs?: number;
}

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
