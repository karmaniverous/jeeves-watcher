/**
 * @module api/handlers/renderSource
 * `POST /render { source }`: looks up the stored designated rule, retrieves the document through its callback and renders it. Never cached, never writes points or issues.
 */

import {
  type ApiErrorCode,
  type DocumentFailure,
  issueTypeSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply } from 'fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import { normalizeError } from '../../util/normalizeError';
import { sendError, sendSourcesNotAvailable } from '../sendError';

/**
 * Map a pipeline failure to its API code and status. Pure.
 *
 * @param issueType - The failure's issue type.
 * @returns `source_unavailable` (502), `unsupported_content_type` (422) or
 *   `pipeline_error` (422).
 */
function renderFailureCode(issueType: string): {
  code: ApiErrorCode;
  status: number;
} {
  if (issueType === 'source_unavailable') {
    return { code: 'source_unavailable', status: 502 };
  }
  if (issueType === 'unsupported_content_type') {
    return { code: 'unsupported_content_type', status: 422 };
  }
  return { code: 'pipeline_error', status: 422 };
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
  const { code, status } = renderFailureCode(issue);
  const issueType = issueTypeSchema.safeParse(issue).data;
  return sendError(reply, status, code, message, { details, issueType });
}

/**
 * Render a source document and send the response.
 *
 * - `404 source_not_indexed`: no stored point, so no designated rule is
 *   known.
 * - `404 source_not_found`: the callback answered 404 (points are left
 *   alone; notify or reindex deletes them).
 * - `502 source_unavailable`; `422 unsupported_content_type`;
 *   `422 pipeline_error` for other pipeline failures. `issueType` names the
 *   failure (`rule_missing`, `match_failed`, ...).
 * - `503 not_available` without source support; `500 internal_error` on an
 *   unexpected error.
 * - `200 { renderAs, content, rules, metadata }`, with
 *   `Cache-Control: no-cache`.
 *
 * @param processor - The document processor.
 * @param ref - The exact `<name>://<id>` reference.
 * @param reply - Fastify reply.
 * @param logger - Logger.
 * @returns The sent reply.
 */
export async function renderSource(
  processor: DocumentProcessorInterface,
  ref: string,
  reply: FastifyReply,
  logger: pino.Logger,
): Promise<FastifyReply> {
  void reply.header('Cache-Control', 'no-cache');
  if (!hasSourceOperations(processor)) {
    return sendSourcesNotAvailable(reply);
  }
  try {
    const ops = processor.sourceOperations();
    const rule = await ops.storedRule(ref);
    if (rule === null) {
      return await sendError(
        reply,
        404,
        'source_not_indexed',
        'Source document not indexed',
      );
    }
    const outcome = await ops.render(ref, rule);
    if (outcome.kind === 'gone') {
      return await sendError(
        reply,
        404,
        'source_not_found',
        'Source document not found',
      );
    }
    if (outcome.kind === 'failed') {
      return await sendRenderFailure(reply, outcome.error);
    }
    const { renderAs, content, rules, metadata } = outcome.result;
    return await reply.send({ renderAs, content, rules, metadata });
  } catch (error) {
    const err = normalizeError(error);
    logger.error({ source: ref, err }, 'Source render failed');
    return sendError(reply, 500, 'internal_error', err.message);
  }
}
