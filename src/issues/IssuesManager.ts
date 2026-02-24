/**
 * @module issues/IssuesManager
 * Manages persistent issue tracking for file processing failures. Read-modify-write with in-memory cache.
 */

import { join } from 'node:path';

import type pino from 'pino';

import { JsonFileStore } from '../util/JsonFileStore';
import type { IssueRecord, IssuesFile } from './types';

/**
 * Manages a persistent issues.json file tracking processing failures per file.
 */
export class IssuesManager extends JsonFileStore<IssuesFile> {
  constructor(stateDir: string, logger: pino.Logger) {
    super({ filePath: join(stateDir, 'issues.json'), logger });
  }

  protected createEmpty(): IssuesFile {
    return {};
  }

  /** Record or update an issue for a file path. */
  record(
    filePath: string,
    rule: string,
    error: string,
    errorType: IssueRecord['errorType'],
  ): void {
    const issues = this.load();
    const existing = issues[filePath] as IssueRecord | undefined;
    issues[filePath] = {
      rule,
      error,
      errorType,
      timestamp: new Date().toISOString(),
      attempts: (existing?.attempts ?? 0) + 1,
    };
    this.save();
    this.logger.debug({ filePath, errorType }, 'Issue recorded');
  }

  /** Clear an issue for a file path (called on successful processing). */
  clear(filePath: string): void {
    const issues = this.load();
    if (filePath in issues) {
      Reflect.deleteProperty(issues, filePath);
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
