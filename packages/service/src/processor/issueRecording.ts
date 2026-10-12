/**
 * @module processor/issueRecording
 * Typed processing-failure handling (#255): tags pipeline errors with a canonical issue code, logs them, and records or clears issues via the injected IssuesManager. No other I/O.
 */

import type { IssueType } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { IssuesManager } from '../issues';
import { logError } from '../util/logError';

/**
 * An error thrown by a pipeline stage, tagged with the canonical issue code
 * that describes the stage. The original error is kept as `cause`.
 */
export class ProcessingFailure extends Error {
  /** Canonical issue code for the failed stage. */
  readonly issueType: IssueType;

  /**
   * @param issueType - Canonical issue code for the failed stage.
   * @param cause - The original error.
   */
  constructor(issueType: IssueType, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ProcessingFailure';
    this.issueType = issueType;
  }
}

/**
 * Run a pipeline stage, tagging any failure with an issue code. A failure
 * already tagged by an inner stage keeps its original code.
 *
 * @param issueType - Issue code to attach on failure.
 * @param fn - The stage to run.
 * @returns The stage's result.
 */
export async function withIssueType<T>(
  issueType: IssueType,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProcessingFailure) throw error;
    throw new ProcessingFailure(issueType, error);
  }
}

/** Issues-store operations the processor needs. */
export type ProcessorIssues = Pick<IssuesManager, 'record' | 'clear' | 'get'>;

/** Dependencies for {@link handleFileErrors}. */
export interface FileErrorDeps {
  /** Logger for the failure. */
  logger: pino.Logger;
  /** Issues store; when absent, failures are only logged. */
  issuesManager?: ProcessorIssues;
}

/** What failed, for logging and issue recording. */
export interface FileErrorContext {
  /** Document key (file path) the issue is recorded under. */
  filePath: string;
  /** Operation description, used as the log message and issue `operation`. */
  operation: string;
  /**
   * Issue code for untagged failures. When omitted, failures are logged but
   * never recorded as issues.
   */
  issueType?: IssueType;
}

/**
 * Run a file operation; on failure log it, record a typed issue (replacing
 * any earlier issues for the file) and return `fallback`.
 *
 * @param deps - Logger and optional issues store.
 * @param context - File path, operation and fallback issue code.
 * @param fn - The operation.
 * @param fallback - Value returned when the operation fails.
 * @returns The operation's result, or `fallback` on failure.
 */
export async function handleFileErrors<T>(
  deps: FileErrorDeps,
  context: FileErrorContext,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const { filePath, operation, issueType } = context;
    const tagged = error instanceof ProcessingFailure ? error : undefined;
    logError(deps.logger, tagged?.cause ?? error, { filePath }, operation);

    const type = tagged?.issueType ?? issueType;
    if (type && deps.issuesManager) {
      const message = error instanceof Error ? error.message : String(error);
      deps.issuesManager.clear(filePath);
      deps.issuesManager.record(filePath, type, message, { operation });
    }
    return fallback;
  }
}

/**
 * Clear a file's issues when processing skipped re-embedding because the
 * content hash is unchanged. An `upsert_error` is kept: a partial upsert can
 * leave the new hash on chunk 0, so a hash match does not prove success.
 *
 * @param issuesManager - Issues store, if any.
 * @param filePath - Document key (file path).
 */
export function clearIssuesOnUnchanged(
  issuesManager: ProcessorIssues | undefined,
  filePath: string,
): void {
  const issues = issuesManager?.get(filePath);
  if (!issues || issues.some((issue) => issue.type === 'upsert_error')) return;
  issuesManager?.clear(filePath);
}
