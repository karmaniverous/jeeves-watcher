/**
 * @module api/handlers/render
 * POST /render route handler. Runs a file (path) or a source document (source, retrieved through its callback with its stored designated rule) through the rule engine and returns rendered content.
 */

import {
  documentTarget,
  extractWatchPathStrings,
  renderRequestSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { WatchConfig } from '../../config/schemas';
import type { WatcherProcessor } from '../../processor';
import { ProcessingFailure } from '../../processor/issueRecording';
import { isPathWatched } from '../../util/isPathWatched';
import { RequestError } from '../requestError';
import { sendError } from '../sendError';
import { parseBody } from './parseBody';
import { renderSource } from './renderSource';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the render handler. */
export interface RenderHandlerDeps {
  /** The document processor. */
  processor: WatcherProcessor;
  /** Getter for live watch config. */
  getWatch: () => WatchConfig;
  /** Logger instance. */
  logger: pino.Logger;
}

/** Whether an error (or its cause) is a missing-file error. */
function isMissingFile(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    if (e.message.includes('ENOENT') || e.message.includes('no such file')) {
      return true;
    }
  }
  return false;
}

/**
 * Create the POST /render route handler. Register it with
 * `withCacheUnlessSource`: source renders must bypass the response cache.
 *
 * File renders: a path outside the watch scope is `403 path_not_watched`, a
 * missing file `404 not_found`, any other rendering failure
 * `422 pipeline_error` whose `issueType` names the failed stage
 * (`extraction_error` unless a stage tagged it). Failures outside rendering
 * (body parsing aside) are logged and answered with a generic
 * `500 internal_error` (`wrapHandler`).
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createRenderHandler(deps: RenderHandlerDeps) {
  const { processor, getWatch, logger } = deps;

  return wrapHandler(
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const target = documentTarget(
        parseBody(renderRequestSchema, request.body),
      );
      if (target.kind === 'source') {
        return renderSource(processor, target.source, reply);
      }
      const filePath = target.path;

      // Validate path is within watched scope (live config)
      const watch = getWatch();
      if (
        !isPathWatched(
          filePath,
          extractWatchPathStrings(watch.paths),
          watch.ignored,
        )
      ) {
        throw new RequestError(
          'path_not_watched',
          'Path is outside watched scope',
        );
      }

      try {
        const result = await processor.renderFile(filePath);

        // Passthrough responses should not be cached
        if (!result.transformed) {
          void reply.header('Cache-Control', 'no-cache');
        }

        return {
          renderAs: result.renderAs,
          content: result.content,
          rules: result.rules,
          metadata: result.metadata,
        };
      } catch (error) {
        if (isMissingFile(error)) {
          throw new RequestError('not_found', 'File not found');
        }
        // Everything renderFile runs is the extraction pipeline (stat,
        // extract, rules, template): its failures are the documented
        // `422 pipeline_error`, tagged `extraction_error` unless a stage
        // already tagged them.
        const failure =
          error instanceof ProcessingFailure
            ? error
            : new ProcessingFailure('extraction_error', error);
        logger.warn({ filePath, err: failure }, 'Render failed');
        return sendError(reply, 'pipeline_error', failure.message, {
          details: failure.details,
          issueType: failure.issueType,
        });
      }
    },
    logger,
    'Render',
  );
}
