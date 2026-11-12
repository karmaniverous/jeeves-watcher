/**
 * @module api/errors
 * Every error the watcher means a caller to see, as a jeeves `defineError` class (0.22.0, Design 2): a `WATCHER_*` code, a fixed caller-facing message and a status. The jeeves catalog scope (and `registerErrorHandlers`) sends them as Fastify's standard error body; anything else thrown is a masked 500. Pure.
 */

import { defineError } from '@karmaniverous/jeeves/fastify';
import {
  ISSUE_TYPES,
  type IssueType,
} from '@karmaniverous/jeeves-watcher-core';

import { API_LOCK_RETRY_AFTER_S } from '../processor/DocumentLocks';
import { ROUTE_LOCK_WAIT_MS } from '../vcs/RootGitLock';

/** Longest `%s` argument a message carries (Design 2, message rule 1). */
export const MESSAGE_ARG_MAX = 300;

/**
 * Cap a `%s` argument at {@link MESSAGE_ARG_MAX} characters (an ellipsis
 * marks a cut). Pure.
 *
 * @param value - The argument.
 * @returns It, at most {@link MESSAGE_ARG_MAX} characters long.
 */
export function capArg(value: string): string {
  return value.length <= MESSAGE_ARG_MAX
    ? value
    : `${value.slice(0, MESSAGE_ARG_MAX - 1)}…`;
}

export const Unauthorized = defineError(
  'WATCHER_UNAUTHORIZED',
  'A valid API key is required: send Authorization: Bearer <key>.',
  401,
);

export const PathNotWatched = defineError(
  'WATCHER_PATH_NOT_WATCHED',
  'The path is outside the watched scope or is gitignored.',
  403,
);

/** An unknown route, or a gated one (answered identically, D28, D50). */
export const RouteNotFound = defineError(
  'WATCHER_NOT_FOUND',
  'Route %s:%s not found',
  404,
);

export const PathNotFound = defineError(
  'WATCHER_NOT_FOUND',
  'The file or directory does not exist.',
  404,
);

export const VcsRootNotFound = defineError(
  'WATCHER_NOT_FOUND',
  'No version-controlled watch root matches the path or glob.',
  404,
);

export const VcsRootNotVersioned = defineError(
  'WATCHER_NOT_FOUND',
  'The named root is not a version-controlled watch root.',
  404,
);

export const VcsFileNotFound = defineError(
  'WATCHER_NOT_FOUND',
  'The file does not exist at that commit.',
  404,
);

export const ExclusionNotFound = defineError(
  'WATCHER_NOT_FOUND',
  'The pattern is not excluded on this root.',
  404,
);

export const SourceNotIndexed = defineError(
  'WATCHER_SOURCE_NOT_INDEXED',
  'The source document is not indexed.',
  404,
);

export const SourceNotFound = defineError(
  'WATCHER_SOURCE_NOT_FOUND',
  'The source reports that the document does not exist.',
  404,
);

export const UnsupportedContentType = defineError(
  'WATCHER_UNSUPPORTED_CONTENT_TYPE',
  'The source returned a body that is not a JSON object.',
  422,
);

export const SourceUnavailable = defineError(
  'WATCHER_SOURCE_UNAVAILABLE',
  'The source could not be reached or answered with an error.',
  502,
);

export const SourcesNotSupported = defineError(
  'WATCHER_NOT_AVAILABLE',
  'Source documents are not available on this instance.',
  503,
);

export const WatcherNotReady = defineError(
  'WATCHER_NOT_AVAILABLE',
  'The filesystem watcher is not initialized.',
  503,
);

export const FacetIndexNotReady = defineError(
  'WATCHER_NOT_AVAILABLE',
  'Facet counts need the %s system index, which is not ready yet; retry shortly.',
  503,
);

export const FacetBudgetExceeded = defineError(
  'WATCHER_NOT_AVAILABLE',
  'Facet counts exceeded the time budget; not counted: %s. Count fewer fields or narrow the filter.',
  503,
);

/** Send with `Retry-After: 10` ({@link documentBusy}). */
export const DocumentBusy = defineError(
  'WATCHER_NOT_AVAILABLE',
  'The document is being processed; retry after 10 s.',
  503,
);

/** Send with `Retry-After: 30` ({@link vcsBusy}). */
export const VcsBusy = defineError(
  'WATCHER_NOT_AVAILABLE',
  'Version control is busy on this root; retry after 30 s.',
  503,
);

export const PruneNotAvailable = defineError(
  'WATCHER_NOT_AVAILABLE',
  'Prune needs a vector store, and none is configured.',
  503,
);

export const ScanInProgress = defineError(
  'WATCHER_SCAN_IN_PROGRESS',
  'The initial filesystem scan is still running; retry when it finishes.',
  503,
);

/** Send through {@link embeddingUnavailable} (adds `Retry-After`). */
export const EmbeddingUnavailable = defineError(
  'WATCHER_EMBEDDING_UNAVAILABLE',
  'The embedding provider is unavailable; retry later.',
  503,
);

export const FilterRejected = defineError(
  'WATCHER_INVALID_REQUEST',
  'The vector store rejected the filter: %s',
  400,
);

export const FacetFieldNotIndexed = defineError(
  'WATCHER_INVALID_REQUEST',
  'No usable payload index for field(s): %s',
  400,
);

export const EmptyRuleList = defineError(
  'WATCHER_INVALID_REQUEST',
  'rules must name at least one rule',
  400,
);

export const UnknownRules = defineError(
  'WATCHER_INVALID_REQUEST',
  'Unknown rule(s): %s',
  400,
);

export const MetadataInvalid = defineError(
  'WATCHER_INVALID_REQUEST',
  "The metadata does not match the matched rules' schemas: %s",
  400,
);

export const RulesInvalid = defineError(
  'WATCHER_INVALID_REQUEST',
  'The rules are not valid: %s',
  400,
);

export const PathNotFileOrDirectory = defineError(
  'WATCHER_INVALID_REQUEST',
  'The path is neither a file nor a directory.',
  400,
);

export const ExcludeGlobRefused = defineError(
  'WATCHER_INVALID_REQUEST',
  'The exclude glob is refused: %s',
  400,
);

/** Seconds a caller waits on a busy root git lock: the route's own wait (D102). */
const VCS_BUSY_RETRY_AFTER_S = ROUTE_LOCK_WAIT_MS / 1000;

/** An error with a `Retry-After` header jeeves passes on (allowlisted). */
function withRetryAfter<E extends Error>(error: E, seconds: number): E {
  return Object.assign(error, {
    headers: { 'retry-after': String(seconds) },
  });
}

/** @returns A {@link DocumentBusy} with `Retry-After: 10`. */
export const documentBusy = () =>
  withRetryAfter(new DocumentBusy(), API_LOCK_RETRY_AFTER_S);

/** @returns A {@link VcsBusy} with `Retry-After: 30`. */
export const vcsBusy = () =>
  withRetryAfter(new VcsBusy(), VCS_BUSY_RETRY_AFTER_S);

/**
 * An {@link EmbeddingUnavailable}, with `Retry-After` (whole seconds,
 * rounded up, at least 1) when the provider's back-off is known.
 *
 * @param retryAfterMs - The back-off left, ms, if known.
 * @returns The error.
 */
export function embeddingUnavailable(retryAfterMs?: number): Error {
  const error = new EmbeddingUnavailable();
  return retryAfterMs === undefined
    ? error
    : withRetryAfter(error, Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

/** The issue types with their own code rather than a pipeline code. */
const NON_PIPELINE_ISSUE_TYPES = [
  'source_unavailable',
  'unsupported_content_type',
] as const;

/** An issue type with a `WATCHER_PIPELINE_<TYPE>_ERROR` code (D203 (2)). */
export type PipelineIssueType = Exclude<
  IssueType,
  (typeof NON_PIPELINE_ISSUE_TYPES)[number]
>;

/** Each pipeline issue type's caller-facing message. */
const PIPELINE_MESSAGES: Readonly<Record<PipelineIssueType, string>> = {
  type_collision: "The document's metadata types conflict with each other.",
  interpolation_error:
    "A rule's template or set expression failed for this document.",
  extraction_error: 'The document could not be extracted.',
  embedding_error: 'The document could not be embedded.',
  upsert_error: 'The document could not be written to the vector store.',
  match_failed: 'The document does not match its designated rule.',
  rule_missing: 'The designated rule does not exist.',
  no_content: 'The document has no content to render.',
  too_large: 'The document is over a processing size limit.',
};

/**
 * The `WATCHER_PIPELINE_<TYPE>_ERROR` code of an issue type: the type in
 * upper case with a trailing `_error` dropped, so the suffix never doubles
 * (`extraction_error` gives `WATCHER_PIPELINE_EXTRACTION_ERROR`). Pure.
 *
 * @param issueType - A pipeline issue type.
 * @returns Its code.
 */
export function pipelineErrorCode(issueType: PipelineIssueType): string {
  return `WATCHER_PIPELINE_${issueType.replace(/_error$/, '').toUpperCase()}_ERROR`;
}

/** Whether an issue type has a pipeline code. */
export function isPipelineIssueType(
  issueType: IssueType,
): issueType is PipelineIssueType {
  return !(NON_PIPELINE_ISSUE_TYPES as readonly string[]).includes(issueType);
}

/** One `defineError` class per pipeline issue type, built from `ISSUE_TYPES`. */
export const PIPELINE_ERRORS = Object.fromEntries(
  ISSUE_TYPES.filter(isPipelineIssueType).map((type) => [
    type,
    defineError(pipelineErrorCode(type), PIPELINE_MESSAGES[type], 422),
  ]),
) as Readonly<Record<PipelineIssueType, ReturnType<typeof defineError>>>;

/**
 * The caller's error for a render failure, by issue type:
 * `source_unavailable` is `SourceUnavailable` (502),
 * `unsupported_content_type` is `UnsupportedContentType` (422), every other
 * type its pipeline class (422); a failure without a known issue type is an
 * extraction error (D203 (2)). Pure.
 *
 * @param issueType - The failure's issue type, if known.
 * @returns The error to throw.
 */
export function renderFailureError(issueType: IssueType | undefined): Error {
  if (issueType === 'source_unavailable') return new SourceUnavailable();
  if (issueType === 'unsupported_content_type')
    return new UnsupportedContentType();
  return new PIPELINE_ERRORS[issueType ?? 'extraction_error']();
}
