/**
 * @module processor/issueRecording
 * Typed processing-failure handling (#255): tags pipeline errors with a canonical issue code, logs them, and records or clears issues via the injected IssuesManager. No other I/O.
 */

import type {
  DocumentResult,
  IssueType,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { IssuesManager } from '../issues';
import {
  formatRuleErrors,
  type RuleApplicationError,
} from '../rules/ruleErrors';
import { isSourceReference } from '../util/documentKey';
import { logError } from '../util/logError';

/**
 * An error thrown by a pipeline stage, tagged with the canonical issue code
 * that describes the stage. The original error is kept as `cause`.
 */
export class ProcessingFailure extends Error {
  /** Canonical issue code for the failed stage. */
  readonly issueType: IssueType;
  /** Optional structured details (e.g. AJV errors for `match_failed`). */
  readonly details?: unknown;

  /**
   * @param issueType - Canonical issue code for the failed stage.
   * @param cause - The original error (or a message).
   * @param details - Optional structured details.
   */
  constructor(issueType: IssueType, cause: unknown, details?: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ProcessingFailure';
    this.issueType = issueType;
    this.details = details;
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

/**
 * Issue code for failures no stage tagged (files, source documents and
 * unexpected source notify rejections alike).
 */
export const UNTAGGED_ISSUE_TYPE = 'extraction_error' satisfies IssueType;

/** Dependencies for {@link reportFailure} and {@link handleFailures}. */
export interface FailureDeps {
  /** Logger for the failure; when absent, nothing is logged. */
  logger?: pino.Logger;
  /** Issues store; when absent, failures are only logged. */
  issuesManager?: Pick<IssuesManager, 'record' | 'clear'>;
}

/** What failed, for logging and issue recording. */
export interface FailureContext {
  /** Document key (file path or source reference) the issue is recorded under. */
  key: string;
  /** Operation description, used as the log message and issue `operation`. */
  operation: string;
  /**
   * Issue code for untagged failures. When omitted, failures are logged but
   * never recorded as issues.
   */
  issueType?: IssueType;
  /** Designated rule of a source document, recorded on the issue. */
  rule?: string;
}

/** A failure after it has been logged and (when typed) recorded. */
export interface ReportedFailure {
  /** Issue code, when the failure was typed. */
  type?: IssueType;
  /** Error message. */
  message: string;
  /** Structured details carried by a {@link ProcessingFailure}. */
  details?: unknown;
}

/**
 * Log a failure and record a typed issue for the document key (replacing any
 * earlier issues for it). Untagged failures use `context.issueType`. The
 * issue carries `context.rule` and the failure's structured `details` when
 * present; a tagged failure's `cause` is what gets logged.
 *
 * @param deps - Optional logger and issues store.
 * @param context - Document key, operation and fallback issue code.
 * @param error - The failure.
 * @returns The issue code, message and details.
 */
export function reportFailure(
  deps: FailureDeps,
  context: FailureContext,
  error: unknown,
): ReportedFailure {
  const { key, operation, issueType, rule } = context;
  const tagged = error instanceof ProcessingFailure ? error : undefined;
  if (deps.logger) {
    const fields = isSourceReference(key) ? { source: key } : { filePath: key };
    logError(deps.logger, tagged?.cause ?? error, fields, operation);
  }

  const type = tagged?.issueType ?? issueType;
  const message = error instanceof Error ? error.message : String(error);
  const details = tagged?.details;
  if (type && deps.issuesManager) {
    deps.issuesManager.clear(key);
    deps.issuesManager.record(key, type, message, {
      operation,
      ...(rule === undefined ? {} : { rule }),
      ...(details === undefined ? {} : { details }),
    });
  }
  return { type, message, details };
}

/**
 * The per-document `failed` result of a source document for a reported
 * failure (an untyped failure reports {@link UNTAGGED_ISSUE_TYPE}).
 *
 * @param ref - The exact `<name>://<id>` reference.
 * @param failure - The reported failure.
 * @returns The `failed` result.
 */
export function failedSourceResult(
  ref: string,
  failure: ReportedFailure,
): DocumentResult {
  const { type = UNTAGGED_ISSUE_TYPE, message, details } = failure;
  return {
    source: ref,
    status: 'failed',
    error: { code: type, message, ...(details ? { details } : {}) },
  };
}

/** Options of {@link handleFailures}. */
export interface HandleFailuresOptions<T> {
  /** Value returned when the operation fails. */
  fallback: T;
}

/**
 * Run a document operation; on failure report it (see
 * {@link reportFailure}) and return `fallback`.
 *
 * @param deps - Logger and optional issues store.
 * @param context - Document key, operation and fallback issue code.
 * @param fn - The operation.
 * @param options - The fallback value.
 * @returns The operation's result, or `fallback` on failure.
 */
export async function handleFailures<T>(
  deps: FailureDeps,
  context: FailureContext,
  fn: () => Promise<T>,
  options: HandleFailuresOptions<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    reportFailure(deps, context, error);
    return options.fallback;
  }
}

/** Operation recorded on interpolation issues of files. */
const RULE_INTERPOLATION_OPERATION = 'Rule interpolation';

/**
 * Record a file's rule interpolation failures (schema `set`, `render`,
 * `template`) as one `interpolation_error` issue, after processing finished
 * (the file is still indexed, as before). Other issues for the file are
 * kept; an identical interpolation issue is not recorded twice.
 *
 * @param issuesManager - Issues store, if any.
 * @param key - Document key (file path or source reference).
 * @param errors - The rule errors (nothing is recorded when empty).
 */
export function recordRuleErrors(
  issuesManager: ProcessorIssues | undefined,
  key: string,
  errors: readonly RuleApplicationError[] | undefined,
): void {
  if (!issuesManager || !errors?.length) return;
  const message = formatRuleErrors(errors);
  const existing = issuesManager.get(key) ?? [];
  const duplicate = existing.some(
    (i) => i.type === 'interpolation_error' && i.message === message,
  );
  if (duplicate) return;
  issuesManager.record(key, 'interpolation_error', message, {
    operation: RULE_INTERPOLATION_OPERATION,
    rules: [...new Set(errors.map((e) => e.rule))],
    details: errors,
  });
}

/**
 * Clear a document's issues when processing skipped re-embedding because the
 * content hash is unchanged. An `upsert_error` is kept: a partial upsert can
 * leave the new hash on chunk 0, so a hash match does not prove success.
 *
 * @param issuesManager - Issues store, if any.
 * @param key - Document key (file path or source reference).
 */
export function clearIssuesOnUnchanged(
  issuesManager: ProcessorIssues | undefined,
  key: string,
): void {
  const issues = issuesManager?.get(key);
  if (!issues || issues.some((issue) => issue.type === 'upsert_error')) return;
  issuesManager?.clear(key);
}
