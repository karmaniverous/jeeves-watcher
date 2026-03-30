/**
 * @module util/BinaryFileStore
 * Binary-backed read/modify/write store with in-memory caching and debounced flush.
 *
 * Persists a single JS object to disk using V8 structured clone serialization.
 * I/O: synchronous fs read/write.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { deserialize, serialize } from 'node:v8';

import type pino from 'pino';

/** Options for {@link BinaryFileStore}. */
interface BinaryFileStoreOptions {
  /** Path to the binary file on disk. */
  filePath: string;
  /** Logger for warnings. */
  logger: pino.Logger;
  /** Debounce interval in ms for flushing dirty state. Default: 5000. */
  flushDebounceMs?: number;
}

/**
 * Base class for binary file stores.
 *
 * @typeParam T - The stored data structure.
 */
export abstract class BinaryFileStore<T> {
  /** Path to the binary file on disk. */
  protected readonly filePath: string;
  /** In-memory cache of the file contents, or `null` if not yet loaded. */
  protected cache: T | null = null;
  /** Logger instance for warnings and diagnostics. */
  protected readonly logger: pino.Logger;

  private readonly flushDebounceMs: number;
  private flushTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  protected constructor(options: BinaryFileStoreOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.flushDebounceMs = options.flushDebounceMs ?? 5000;

    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  /** Create an empty default value when file is missing or unreadable. */
  protected abstract createEmpty(): T;

  /** Load from disk into cache if not already loaded. */
  protected load(): T {
    if (this.cache) return this.cache;

    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath);
        this.cache = deserialize(raw) as T;
      } else {
        this.cache = this.createEmpty();
      }
    } catch (error) {
      this.logger.warn(
        { filePath: this.filePath, err: error },
        'Failed to read binary store file, starting fresh',
      );
      this.cache = this.createEmpty();
    }

    return this.cache;
  }

  /**
   * Mark the store dirty and schedule a debounced flush.
   */
  protected markDirty(): void {
    this.dirty = true;

    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.flushDebounceMs);
  }

  /**
   * Flush cache to disk if dirty.
   *
   * Uses an atomic write (tmp + rename) to avoid partial files.
   */
  flush(): void {
    if (!this.dirty) return;

    this.stopAutoFlush();

    const value = this.cache ?? this.createEmpty();

    const tmpPath = `${this.filePath}.tmp`;
    const payload = serialize(value);

    writeFileSync(tmpPath, payload);

    // renameSync does not reliably overwrite on Windows. Remove target first.
    rmSync(this.filePath, { force: true });
    renameSync(tmpPath, this.filePath);

    this.dirty = false;
  }

  /** Stop any pending scheduled flush. Does not flush automatically. */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
