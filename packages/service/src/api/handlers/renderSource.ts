/**
 * @module api/handlers/renderSource
 * `POST /render { source }`: looks up the stored designated rule, retrieves the document through its callback and renders it. Never cached, never writes points or issues.
 */

import type { FastifyReply } from 'fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import { normalizeError } from '../../util/normalizeError';

/** Failure codes that mean the callback (not the document) is at fault. */
const UPSTREAM_CODES = new Set(['source_unavailable']);

/**
 * Render a source document and send the response.
 *
 * - `404 { error: 'Source document not indexed' }`: no stored point, so no
 *   designated rule is known.
 * - `404 { error: 'Source document not found' }`: the callback answered 404
 *   (points are left alone; notify or reindex deletes them).
 * - `502 { error, code }` for `source_unavailable`; `422 { error, code }`
 *   for other pipeline failures (`rule_missing`, `match_failed`, ...).
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
    return reply.status(503).send({
      error: 'Not available',
      message: 'Source documents are not supported by this instance.',
    });
  }
  try {
    const ops = processor.sourceOperations();
    const rule = await ops.storedRule(ref);
    if (rule === null) {
      return await reply
        .status(404)
        .send({ error: 'Source document not indexed' });
    }
    const outcome = await ops.render(ref, rule);
    if (outcome.kind === 'gone') {
      return await reply
        .status(404)
        .send({ error: 'Source document not found' });
    }
    if (outcome.kind === 'failed') {
      const { code, message, details } = outcome.error;
      return await reply
        .status(UPSTREAM_CODES.has(code) ? 502 : 422)
        .send({ error: message, code, ...(details ? { details } : {}) });
    }
    const { renderAs, content, rules, metadata } = outcome.result;
    return await reply.send({ renderAs, content, rules, metadata });
  } catch (error) {
    const err = normalizeError(error);
    logger.error({ source: ref, err }, 'Source render failed');
    return reply.status(500).send({ error: err.message });
  }
}
