/**
 * @module api/handlers/render
 * POST /render route handler. Runs a file (path) or a source document (source, retrieved through its callback with its stored designated rule) through the rule engine and returns rendered content.
 */

import {
  extractWatchPathStrings,
  renderRequestSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { WatchConfig } from '../../config/schemas';
import type { DocumentProcessorInterface } from '../../processor';
import { isPathWatched } from '../../util/isPathWatched';
import { normalizeError } from '../../util/normalizeError';
import { parseBody } from './parseBody';
import { renderSource } from './renderSource';

/** Dependencies for the render handler. */
export interface RenderHandlerDeps {
  /** The document processor. */
  processor: DocumentProcessorInterface;
  /** Getter for live watch config. */
  getWatch: () => WatchConfig;
  /** Logger instance. */
  logger: pino.Logger;
}

/**
 * Create the POST /render route handler. Register it with
 * `withCacheUnlessSource`: source renders must bypass the response cache.
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createRenderHandler(deps: RenderHandlerDeps) {
  const { processor, getWatch, logger } = deps;

  return async (
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ) => {
    const body = parseBody(renderRequestSchema, request.body, reply);
    if (!body) return reply;

    const { path: filePath, source } = body;
    if (source !== undefined) {
      return renderSource(processor, source, reply, logger);
    }
    if (filePath === undefined) {
      // Unreachable: the schema requires exactly one of path or source.
      return reply.status(400).send({ error: 'path is required' });
    }

    // Validate path is within watched scope (live config)
    const watch = getWatch();
    if (
      !isPathWatched(
        filePath,
        extractWatchPathStrings(watch.paths),
        watch.ignored,
      )
    ) {
      return reply.status(403).send({ error: 'Path is outside watched scope' });
    }

    try {
      const result = await processor.renderFile(filePath);

      // Passthrough responses should not be cached
      if (!result.transformed) {
        void reply.header('Cache-Control', 'no-cache');
      }

      return await reply.send({
        renderAs: result.renderAs,
        content: result.content,
        rules: result.rules,
        metadata: result.metadata,
      });
    } catch (error) {
      const { message: msg } = normalizeError(error);

      if (msg.includes('ENOENT') || msg.includes('no such file')) {
        return reply.status(404).send({ error: 'File not found' });
      }

      logger.error({ filePath, err: normalizeError(error) }, 'Render failed');
      return reply.status(422).send({ error: msg });
    }
  };
}
