/**
 * @module api/handlers/documents
 * POST /documents: validates each `{ source, rule }` synchronously, then enqueues accepted references (202) or, with ?wait=true, processes them through the notify queue (200 with per-document results).
 */

import {
  type DocumentRejection,
  type DocumentRejectionError,
  type DocumentResult,
  documentsEnvelopeSchema,
  documentsQuerySchema,
  sourceReferenceSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type {
  SourceOperationsInterface,
  SourceOperationsProvider,
} from '../../processor/SourceOperations';
import {
  type SourceNotifyQueue,
  SourceNotifyQueueStoppedError,
} from '../../queue/SourceNotifyQueue';
import { sendSourcesNotAvailable } from '../sendError';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /documents handler. */
export interface DocumentsHandlerDeps {
  /** Document processor (its source operations). */
  processor: SourceOperationsProvider;
  /** Source notify queue; without it the route answers 503. */
  sourceQueue?: Pick<SourceNotifyQueue, 'enqueue' | 'processNow'>;
  /** Logger. */
  logger: pino.Logger;
}

/** Error returned for a notification accepted while the queue is stopping. */
const QUEUE_STOPPED: DocumentRejectionError = {
  code: 'queue_stopped',
  message: 'The service is shutting down; notify again later',
};

/** A notification after synchronous validation. */
type Checked =
  | { source: string; rule: string; error?: undefined }
  | { source: string; rule: string; error: DocumentRejectionError };

/**
 * Validate one notification: reference syntax (core schema), then the
 * processor's checks (configured source, safe id, rule exists).
 *
 * @param ops - Source operations.
 * @param source - Reference as submitted.
 * @param rule - Designated rule name.
 * @returns The notification, with `error` when rejected.
 */
function check(
  ops: SourceOperationsInterface,
  source: string,
  rule: string,
): Checked {
  const parsed = sourceReferenceSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid reference';
    return { source, rule, error: { code: 'invalid_reference', message } };
  }
  const error = ops.validate(source, rule);
  return error ? { source, rule, error } : { source, rule };
}

/**
 * Process accepted notifications synchronously through the queue (so the
 * queue's concurrency and per-reference coalescing apply) and return one
 * result per submitted document, in submission order.
 *
 * @param queue - The notify queue.
 * @param checked - Validated notifications.
 * @returns Per-document results; rejected ones are `failed` with their code,
 *   and documents the stopping queue refused are `failed` with
 *   `queue_stopped`.
 * @throws Any other rejection of `processNow` (an unexpected failure; the
 *   request then fails with `500 internal_error`).
 */
async function processAll(
  queue: Pick<SourceNotifyQueue, 'processNow'>,
  checked: Checked[],
): Promise<DocumentResult[]> {
  return Promise.all(
    checked.map(async ({ source, rule, error }): Promise<DocumentResult> => {
      if (error) return { source, status: 'failed', error };
      try {
        return await queue.processNow(source, rule);
      } catch (err) {
        if (!(err instanceof SourceNotifyQueueStoppedError)) throw err;
        return { source, status: 'failed', error: QUEUE_STOPPED };
      }
    }),
  );
}

/**
 * Create the POST /documents handler. A failed designated-rule match is
 * never an HTTP error: asynchronously it becomes a `match_failed` issue,
 * with `?wait=true` a `failed` result (Decision 16.4).
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createDocumentsHandler(deps: DocumentsHandlerDeps) {
  return wrapHandler(
    async (
      request: FastifyRequest<{ Body: unknown; Querystring: unknown }>,
      reply: FastifyReply,
    ) => {
      const query = parseBody(documentsQuerySchema, request.query);
      const body = parseBody(documentsEnvelopeSchema, request.body);

      const { processor, sourceQueue } = deps;
      if (!sourceQueue) {
        return sendSourcesNotAvailable(reply);
      }
      const ops = processor.sourceOperations();
      const checked = body.documents.map((d) => check(ops, d.source, d.rule));

      if (query.wait) {
        return { results: await processAll(sourceQueue, checked) };
      }

      const accepted: string[] = [];
      const rejected: DocumentRejection[] = [];
      for (const { source, rule, error } of checked) {
        const failure =
          error ?? (sourceQueue.enqueue(source, rule) ? null : QUEUE_STOPPED);
        if (failure) {
          rejected.push({
            source,
            error: { code: failure.code, message: failure.message },
          });
        } else {
          accepted.push(source);
        }
      }
      if (rejected.length > 0) {
        deps.logger.debug({ rejected }, 'Source notifications rejected');
      }
      return reply.status(202).send({ accepted, rejected });
    },
    deps.logger,
    'Documents notify',
  );
}
