/**
 * @module util/JsonFileStore
 * Small base class for JSON-backed read/modify/write stores with in-memory caching.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type pino from 'pino';

/** Options for {@link JsonFileStore}. */
export interface JsonFileStoreOptions {
  /** Path to the JSON file on disk. */
  filePath: string;
  /** Logger for warnings. */
  logger: pino.Logger;
}

/**
 * Base class for JSON file stores.
 *
 * @typeParam T - The JSON-serializable data structure stored.
 */
export abstract class JsonFileStore<T> {
  protected readonly filePath: string;
  protected cache: T | null = null;
  protected readonly logger: pino.Logger;

  protected constructor(options: JsonFileStoreOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  /** Create an empty default value when file is missing or unreadable. */
  protected abstract createEmpty(): T;

  /** Load from disk into cache if not already loaded. */
  protected load(): T {
    if (this.cache) return this.cache;

    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw) as T;
      } else {
        this.cache = this.createEmpty();
      }
    } catch {
      this.logger.warn(
        { filePath: this.filePath },
        'Failed to read JSON store file, starting fresh',
      );
      this.cache = this.createEmpty();
    }

    return this.cache;
  }

  /** Flush cache to disk. */
  protected save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }
}
