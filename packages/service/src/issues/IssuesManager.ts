/**
 * @module issues/IssuesManager
 * Manages persistent issue tracking for processing failures, keyed by document key (file path or source reference). Read-modify-write with in-memory cache.
 */

import { join } from 'node:path';

import type pino from 'pino';

import { JsonFileStore } from '../util/JsonFileStore';
import type { IssueRecord, IssuesFile } from './types';

/**
 * Manages a persistent issues.json file tracking processing failures per
 * document key (file path or source reference).
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
   * @param key - Document key (file path or source reference).
   * @param type - Canonical issue code.
   * @param message - Error message.
   * @param options - Optional operation, property, rule(s), types and
   *   structured `details` (stored as JSON, e.g. AJV errors).
   */
  record(
    key: string,
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

    // Append to or create the issues array for this document
    if (!issues[key]) {
      issues[key] = [];
    }
    issues[key].push(newIssue);

    this.save();
    this.logger.debug({ key, type }, 'Issue recorded');
  }

  /** Clear the issues of a document key (called on successful processing). */
  clear(key: string): void {
    const issues = this.load();
    if (key in issues) {
      Reflect.deleteProperty(issues, key);
      this.save();
      this.logger.debug({ key }, 'Issue cleared');
    }
  }

  /** Wipe all issues (called on full reindex start). */
  clearAll(): void {
    this.cache = {};
    this.save();
    this.logger.debug('All issues cleared');
  }

  /** Get the current issues of one document key, if any. */
  get(key: string): IssueRecord[] | undefined {
    const issues = this.load()[key];
    return issues ? [...issues] : undefined;
  }

  /** Get all current issues. */
  getAll(): IssuesFile {
    return { ...this.load() };
  }
}
