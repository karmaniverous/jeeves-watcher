/**
 * @module api/handlers/renderSource
 * `POST /render { source }` for the legacy Fastify route: sets
 * `Cache-Control: no-cache` and delegates to `renderSourceDocument`. Never
 * cached, never writes points or issues.
 */

import type { RenderResponse } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply } from 'fastify';

import type { SourceOperationsProvider } from '../../processor/SourceOperations';
import { renderSourceDocument } from './renderSourceDocument';

/**
 * Render a source document (inside the render route's `wrapHandler`).
 *
 * Every documented failure (`404 source_not_indexed`, `404 source_not_found`,
 * `502 source_unavailable`, `422 unsupported_content_type`,
 * `422 pipeline_error` with `issueType`, `503 not_available`) is thrown as a
 * `RequestError` and sent by `wrapHandler`; an unexpected error becomes its
 * generic `500 internal_error`. Every response carries
 * `Cache-Control: no-cache`.
 *
 * @param processor - The document processor.
 * @param ref - The exact `<name>://<id>` reference.
 * @param reply - Fastify reply.
 * @returns The response body.
 */
export async function renderSource(
  processor: SourceOperationsProvider,
  ref: string,
  reply: FastifyReply,
): Promise<RenderResponse> {
  void reply.header('Cache-Control', 'no-cache');
  return renderSourceDocument(processor, ref);
}
