/**
 * @module api/handlers/renderSourceDocument
 * `POST /render { source }`, framework-free: looks up the stored designated
 * rule, retrieves the document through its callback and renders it, throwing
 * a `RequestError` for every documented failure. Shared by the legacy route
 * (`api/handlers/renderSource`) and the catalog `render` handler
 * (`api/catalog/renderHandler`); both answer every source reply with
 * `Cache-Control: no-cache`. Never writes points or issues.
 */

import {
  type ApiErrorCode,
  issueTypeSchema,
  type RenderResponse,
} from '@karmaniverous/jeeves-watcher-core';

import type { SourceOperationsProvider } from '../../processor/SourceOperations';
import { RequestError } from '../requestError';

/**
 * Map a pipeline failure to its API code (the status follows from the
 * code). Pure.
 *
 * @param issueType - The failure's issue type.
 * @returns `source_unavailable`, `unsupported_content_type` or
 *   `pipeline_error`.
 */
function renderFailureCode(issueType: string): ApiErrorCode {
  if (issueType === 'source_unavailable') return 'source_unavailable';
  if (issueType === 'unsupported_content_type') {
    return 'unsupported_content_type';
  }
  return 'pipeline_error';
}

/**
 * Render a source document.
 *
 * A processor without source support (adapted by `withoutSourceSupport`)
 * throws `503 not_available` from its source operations; an unexpected error
 * propagates to the caller.
 *
 * - `404 source_not_indexed`: no stored point, so no designated rule is
 *   known.
 * - `404 source_not_found`: the callback answered 404.
 * - `502 source_unavailable`; `422 unsupported_content_type`;
 *   `422 pipeline_error` for other pipeline failures (`issueType` names the
 *   failure).
 * - Success: `{ renderAs, content, rules, metadata }`.
 *
 * @param processor - The document processor.
 * @param ref - The exact `<name>://<id>` reference.
 * @returns The response body.
 * @throws {@link RequestError} for every documented failure.
 */
export async function renderSourceDocument(
  processor: SourceOperationsProvider,
  ref: string,
): Promise<RenderResponse> {
  const ops = processor.sourceOperations();
  const rule = await ops.storedRule(ref);
  if (rule === null) {
    throw new RequestError('source_not_indexed', 'Source document not indexed');
  }
  const outcome = await ops.render(ref, rule);
  if (outcome.kind === 'gone') {
    throw new RequestError('source_not_found', 'Source document not found');
  }
  if (outcome.kind === 'failed') {
    const { code: issue, message, details } = outcome.error;
    const issueType = issueTypeSchema.safeParse(issue).data;
    throw new RequestError(renderFailureCode(issue), message, {
      details,
      issueType,
    });
  }
  const { renderAs, content, rules, metadata } = outcome.result;
  return { renderAs, content, rules, metadata };
}
