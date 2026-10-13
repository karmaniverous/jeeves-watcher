/**
 * @module api/handlers/renderSource
 * `POST /render { source }`: looks up the stored designated rule, retrieves the document through its callback and renders it. Never cached, never writes points or issues.
 */

import {
  type ApiErrorCode,
  type DocumentFailure,
  issueTypeSchema,
  type RenderResponse,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply } from 'fastify';

import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import { RequestError } from '../requestError';
import { sendError, sendSourcesNotAvailable } from '../sendError';

/**
 * Map a pipeline failure to its API code (the status follows from the code).
 * Pure.
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
 * Send the error response for a failed source render.
 *
 * @param reply - Fastify reply.
 * @param failure - The pipeline failure (`code` is its issue type).
 * @returns The reply.
 */
function sendRenderFailure(
  reply: FastifyReply,
  failure: DocumentFailure,
): FastifyReply {
  const { code: issue, message, details } = failure;
  const issueType = issueTypeSchema.safeParse(issue).data;
  return sendError(reply, renderFailureCode(issue), message, {
    details,
    issueType,
  });
}

/**
 * Render a source document (inside the render route's `wrapHandler`).
 *
 * - `404 source_not_indexed`: no stored point, so no designated rule is
 *   known.
 * - `404 source_not_found`: the callback answered 404 (points are left
 *   alone; notify or reindex deletes them).
 * - `502 source_unavailable`; `422 unsupported_content_type`;
 *   `422 pipeline_error` for other pipeline failures. `issueType` names the
 *   failure (`rule_missing`, `match_failed`, ...).
 * - `503 not_available` without source support. An unexpected error
 *   propagates to `wrapHandler` (logged, generic `500 internal_error`).
 * - `200 { renderAs, content, rules, metadata }`.
 *
 * Every response carries `Cache-Control: no-cache`.
 *
 * @param processor - The document processor.
 * @param ref - The exact `<name>://<id>` reference.
 * @param reply - Fastify reply.
 * @returns The response body, or the reply when an error was sent.
 */
export async function renderSource(
  processor: DocumentProcessorInterface,
  ref: string,
  reply: FastifyReply,
): Promise<FastifyReply | RenderResponse> {
  void reply.header('Cache-Control', 'no-cache');
  if (!hasSourceOperations(processor)) {
    return sendSourcesNotAvailable(reply);
  }
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
    return sendRenderFailure(reply, outcome.error);
  }
  const { renderAs, content, rules, metadata } = outcome.result;
  return { renderAs, content, rules, metadata };
}
