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

  /**
   * Record an issue for a document key (file path or source reference).
   *
   * @param filePath - Document key.
   * @param type - Canonical issue code.
   * @param message - Error message.
   * @param options - Optional operation, property, rule(s), types and
   *   structured `details` (stored as JSON, e.g. AJV errors).
   */
  record(
    filePath: string,
    type: IssueRecord['type'],
    message: string,
    options?: Pick<
      IssueRecord,
      'operation' | 'property' | 'rules' | 'rule' | 'types' | 'details'
    >,
  ): void {
    const issues = this.load();
    const newIssue: IssueRecord = {
      type,
      message,
      timestamp: Math.floor(Date.now() / 1000),
      ...options,
    };

    // Append to or create the issues array for this file
    if (!issues[filePath]) {
      issues[filePath] = [];
    }
    issues[filePath].push(newIssue);

    this.save();
    this.logger.debug({ filePath, type }, 'Issue recorded');
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

  /** Get the current issues for one file path, if any. */
  get(filePath: string): IssueRecord[] | undefined {
    const issues = this.load()[filePath];
    return issues ? [...issues] : undefined;
  }

  /** Get all current issues. */
  getAll(): IssuesFile {
    return { ...this.load() };
  }
}
