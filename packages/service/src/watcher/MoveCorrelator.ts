/**
 * @module watcher/MoveCorrelator
 * Correlates unlink+add events as file moves using content hash matching.
 * Buffers unlink events and matches against subsequent add events.
 */

import { dirname } from 'node:path';

import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import { fileHash } from '../hash';

/** A buffered unlink event pending correlation. */
interface BufferedUnlink {
  path: string;
  hash: string;
  timestamp: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Callback when a move is detected. */
export type OnMove = (oldPath: string, newPath: string) => void;

/** Callback when a buffered unlink times out (treat as delete). */
export type OnDelete = (path: string) => void;

/** Callback when an add has no matching unlink (treat as create). */
export type OnCreate = (path: string) => void;

/** Configuration for the MoveCorrelator. */
export interface MoveCorrelatorOptions {
  /** Whether move correlation is enabled. */
  enabled: boolean;
  /** Buffer timeout in milliseconds. */
  bufferMs: number;
  /** Content hash cache for looking up unlink hashes. */
  contentHashCache: ContentHashCache;
  /** Logger instance. */
  logger: pino.Logger;
  /** Called when a move is detected. */
  onMove: OnMove;
  /** Called when an unlink times out without matching add. */
  onDelete: OnDelete;
  /** Called when an add has no matching unlink. */
  onCreate: OnCreate;
}

/**
 * Correlates unlink+add file system events as moves using content hash matching.
 *
 * When move detection is disabled, events pass straight through.
 */
export class MoveCorrelator {
  private readonly enabled: boolean;
  private readonly bufferMs: number;
  private readonly cache: ContentHashCache;
  private readonly logger: pino.Logger;
  private readonly onMove: OnMove;
  private readonly onDelete: OnDelete;
  private readonly onCreate: OnCreate;

  /** Buffered unlinks indexed by content hash (FIFO per hash). */
  private readonly buffer = new Map<string, BufferedUnlink[]>();

  /** Track unlink burst rate per parent directory for bulk mode. */
  private readonly burstCounters = new Map<
    string,
    { count: number; firstTs: number }
  >();

  /** Threshold: if N+ unlinks from same parent in burstWindowMs, extend buffer. */
  private static readonly BURST_THRESHOLD = 5;
  private static readonly BURST_WINDOW_MS = 500;
  private static readonly BURST_MULTIPLIER = 3;

  constructor(options: MoveCorrelatorOptions) {
    this.enabled = options.enabled;
    this.bufferMs = options.bufferMs;
    this.cache = options.contentHashCache;
    this.logger = options.logger;
    this.onMove = options.onMove;
    this.onDelete = options.onDelete;
    this.onCreate = options.onCreate;
  }

  /**
   * Handle an unlink event. Buffers the event for correlation.
   *
   * @param path - The removed file path.
   */
  handleUnlink(path: string): void {
    if (!this.enabled) {
      this.onDelete(path);
      return;
    }

    const hash = this.cache.get(path);
    if (!hash) {
      this.logger.debug(
        { path },
        'No cached hash for unlinked file, treating as delete',
      );
      this.onDelete(path);
      return;
    }

    const timeoutMs = this.getEffectiveTimeout(path);

    const timer = setTimeout(() => {
      this.expireUnlink(hash, path);
    }, timeoutMs);

    const entry: BufferedUnlink = {
      path,
      hash,
      timestamp: Date.now(),
      timer,
    };

    let entries = this.buffer.get(hash);
    if (!entries) {
      entries = [];
      this.buffer.set(hash, entries);
    }
    entries.push(entry);

    this.logger.debug(
      { path, hash: hash.slice(0, 12), timeoutMs },
      'Buffered unlink for move correlation',
    );
  }

  /**
   * Handle an add event. Checks buffer for matching unlink (move detection).
   *
   * @param path - The added file path.
   */
  async handleAdd(path: string): Promise<void> {
    if (!this.enabled) {
      this.onCreate(path);
      return;
    }

    let hash: string;
    try {
      hash = await fileHash(path);
    } catch {
      this.onCreate(path);
      return;
    }

    const entries = this.buffer.get(hash);
    if (entries && entries.length > 0) {
      // FIFO: consume oldest matching unlink
      const matched = entries.shift()!;
      clearTimeout(matched.timer);
      if (entries.length === 0) this.buffer.delete(hash);

      this.logger.info(
        { oldPath: matched.path, newPath: path },
        'Move detected',
      );
      this.onMove(matched.path, path);
    } else {
      this.onCreate(path);
    }
  }

  /**
   * Flush all buffered unlinks as deletes. Call on shutdown.
   */
  flush(): void {
    for (const [, entries] of this.buffer) {
      for (const entry of entries) {
        clearTimeout(entry.timer);
        this.onDelete(entry.path);
      }
    }
    this.buffer.clear();
    this.burstCounters.clear();
  }

  /** Number of currently buffered unlink events. */
  get pendingCount(): number {
    let count = 0;
    for (const [, entries] of this.buffer) {
      count += entries.length;
    }
    return count;
  }

  /**
   * Get effective timeout, applying burst detection for bulk moves.
   */
  private getEffectiveTimeout(path: string): number {
    const parentDir = dirname(path);
    const now = Date.now();

    let counter = this.burstCounters.get(parentDir);
    if (!counter || now - counter.firstTs > MoveCorrelator.BURST_WINDOW_MS) {
      counter = { count: 0, firstTs: now };
      this.burstCounters.set(parentDir, counter);
    }
    counter.count++;

    if (counter.count >= MoveCorrelator.BURST_THRESHOLD) {
      return this.bufferMs * MoveCorrelator.BURST_MULTIPLIER;
    }
    return this.bufferMs;
  }

  /**
   * Handle a buffered unlink timeout — emit as delete.
   */
  private expireUnlink(hash: string, path: string): void {
    const entries = this.buffer.get(hash);
    if (entries) {
      const idx = entries.findIndex((e) => e.path === path);
      if (idx >= 0) {
        entries.splice(idx, 1);
        if (entries.length === 0) this.buffer.delete(hash);
      }
    }

    this.logger.debug(
      { path, hash: hash.slice(0, 12) },
      'Buffered unlink expired, treating as delete',
    );
    this.onDelete(path);
  }
}
