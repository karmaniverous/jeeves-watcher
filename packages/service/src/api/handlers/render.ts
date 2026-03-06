/**
 * @module api/handlers/render
 * POST /render route handler. Runs a file through the inference rule engine and returns rendered content.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { WatchConfig } from '../../config/schemas';
import type { DocumentProcessorInterface } from '../../processor';
import { isPathWatched } from '../../util/isPathWatched';

/** Dependencies for the render handler. */
export interface RenderHandlerDeps {
  /** The document processor. */
  processor: DocumentProcessorInterface;
  /** Watch config for path validation. */
  watch: WatchConfig;
  /** Logger instance. */
  logger: pino.Logger;
}

/** Request body for POST /render. */
interface RenderRequestBody {
  path: string;
}

/**
 * Create the POST /render route handler.
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createRenderHandler(deps: RenderHandlerDeps) {
  const { processor, watch, logger } = deps;

  return async (
    request: FastifyRequest<{ Body: RenderRequestBody }>,
    reply: FastifyReply,
  ) => {
    const { path: filePath } = request.body;

    if (!filePath || typeof filePath !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: path' });
    }

    // Validate path is within watched scope
    if (!isPathWatched(filePath, watch.paths, watch.ignored)) {
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
      const msg =
        error instanceof Error ? error.message : 'Unknown render error';

      if (msg.includes('ENOENT') || msg.includes('no such file')) {
        return reply.status(404).send({ error: 'File not found' });
      }

      logger.error({ filePath, error: msg }, 'Render failed');
      return reply.status(422).send({ error: msg });
    }
  };
}
