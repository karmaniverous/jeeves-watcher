/**
 * @module issues/IssuesManager
 * Manages persistent issue tracking for file processing failures. Read-modify-write with in-memory cache.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type pino from 'pino';

import type { IssueRecord, IssuesFile } from './types';

/**
 * Manages a persistent issues.json file tracking processing failures per file.
 */
export class IssuesManager {
  private readonly filePath: string;
  private cache: IssuesFile | null = null;
  private readonly logger: pino.Logger;

  constructor(stateDir: string, logger: pino.Logger) {
    this.filePath = join(stateDir, 'issues.json');
    this.logger = logger;
    mkdirSync(stateDir, { recursive: true });
  }

  /** Load from disk into cache if not already loaded. */
  private load(): IssuesFile {
    if (this.cache) return this.cache;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw) as IssuesFile;
      } else {
        this.cache = {};
      }
    } catch {
      this.logger.warn({ filePath: this.filePath }, 'Failed to read issues file, starting fresh');
      this.cache = {};
    }
    return this.cache;
  }

  /** Flush cache to disk. */
  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  /** Record or update an issue for a file path. */
  record(
    filePath: string,
    rule: string,
    error: string,
    errorType: IssueRecord['errorType'],
  ): void {
    const issues = this.load();
    const existing = issues[filePath];
    issues[filePath] = {
      rule,
      error,
      errorType,
      timestamp: new Date().toISOString(),
      attempts: existing ? existing.attempts + 1 : 1,
    };
    this.save();
    this.logger.debug({ filePath, errorType }, 'Issue recorded');
  }

  /** Clear an issue for a file path (called on successful processing). */
  clear(filePath: string): void {
    const issues = this.load();
    if (filePath in issues) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete issues[filePath];
      this.save();
      this.logger.debug({ filePath }, 'Issue cleared');
    }
  }

  /** Wipe all issues (called on full reindex start). */
  clearAll(): void {
    this.cache = {};
    this.save();
    this.logger.debug('All issues cleared');
  }

  /** Get all current issues. */
  getAll(): IssuesFile {
    return { ...this.load() };
  }
}
