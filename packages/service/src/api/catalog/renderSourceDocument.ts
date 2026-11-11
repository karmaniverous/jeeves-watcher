/**
 * @module api/catalog/renderSourceDocument
 * `POST /render { source }`, framework-free: looks up the stored designated
 * rule, retrieves the document through its callback and renders it,
 * throwing a `defineError` class for every documented failure and logging a
 * render failure's message and details with the reference. Used by the
 * catalog `render` handler (`api/catalog/renderHandler`). Never writes
 * points or issues.
 */

import {
  issueTypeSchema,
  type RenderResponse,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { SourceOperationsProvider } from '../../processor/SourceOperations';
import {
  renderFailureError,
  SourceNotFound,
  SourceNotIndexed,
} from '../errors';

/**
 * Render a source document.
 *
 * A processor without source support (adapted by `withoutSourceSupport`)
 * throws `SourcesNotSupported` from its source operations; an unexpected
 * error propagates to the caller.
 *
 * - `404 WATCHER_SOURCE_NOT_INDEXED`: no stored point, so no designated
 *   rule is known.
 * - `404 WATCHER_SOURCE_NOT_FOUND`: the callback answered 404.
 * - `502 WATCHER_SOURCE_UNAVAILABLE`; `422 WATCHER_UNSUPPORTED_CONTENT_TYPE`;
 *   `422 WATCHER_PIPELINE_<TYPE>_ERROR` for other pipeline failures, by
 *   issue type (D203 (2)). The failure's message and details are logged.
 * - Success: `{ renderAs, content, rules, metadata }`.
 *
 * @param processor - The document processor.
 * @param ref - The exact `<name>://<id>` reference.
 * @param logger - Where a render failure is logged.
 * @returns The response body.
 */
export async function renderSourceDocument(
  processor: SourceOperationsProvider,
  ref: string,
  logger: Pick<pino.Logger, 'warn'>,
): Promise<RenderResponse> {
  const ops = processor.sourceOperations();
  const rule = await ops.storedRule(ref);
  if (rule === null) throw new SourceNotIndexed();
  const outcome = await ops.render(ref, rule);
  if (outcome.kind === 'gone') throw new SourceNotFound();
  if (outcome.kind === 'failed') {
    const { code: issue, message, details } = outcome.error;
    logger.warn(
      { source: ref, issueType: issue, message, details },
      'Render failed',
    );
    throw renderFailureError(issueTypeSchema.safeParse(issue).data);
  }
  const { renderAs, content, rules, metadata } = outcome.result;
  return { renderAs, content, rules, metadata };
}
