import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';
import { omit } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import { writeMetadata } from '../metadata';
import { SYSTEM_METADATA_KEYS } from '../metadata/constants';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import type { VectorStoreClient } from '../vectorStore';
import { processAllFiles } from './processAllFiles';

/**
 * Options for {@link createApiServer}.
 */
export interface ApiServerOptions {
  /** The document processor. */
  processor: DocumentProcessor;
  /** The vector store client. */
  vectorStore: VectorStoreClient;
  /** The embedding provider. */
  embeddingProvider: EmbeddingProvider;
  /** The event queue. */
  queue: EventQueue;
  /** The application configuration. */
  config: JeevesWatcherConfig;
  /** The logger instance. */
  logger: pino.Logger;
}

/**
 * Create the Fastify API server with all routes registered.
 *
 * The returned instance is not yet listening — call `server.listen()` to start.
 *
 * @param options - The server options.
 * @returns A configured Fastify instance.
 */
export function createApiServer(options: ApiServerOptions): FastifyInstance {
  const { processor, vectorStore, embeddingProvider, logger } = options;
  const app = Fastify({ logger: false });

  app.get('/status', () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  app.post<{ Body: { path: string; metadata: Record<string, unknown> } }>(
    '/metadata',
    async (request, reply) => {
      try {
        const { path, metadata } = request.body;
        await processor.processMetadataUpdate(path, metadata);
        return { ok: true };
      } catch (error) {
        logger.error({ error }, 'Metadata update failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  app.post<{ Body: { query: string; limit?: number } }>(
    '/search',
    async (request, reply) => {
      try {
        const { query, limit = 10 } = request.body;
        const vectors = await embeddingProvider.embed([query]);
        const results = await vectorStore.search(vectors[0], limit);
        return results;
      } catch (error) {
        logger.error({ error }, 'Search failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  app.post('/reindex', async (_request, reply) => {
    try {
      const count = await processAllFiles(
        options.config.watch.paths,
        options.config.watch.ignored,
        processor,
        'processFile',
      );

      return await reply.status(200).send({ ok: true, filesIndexed: count });
    } catch (error) {
      logger.error({ error }, 'Reindex failed');
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/rebuild-metadata', async (_request, reply) => {
    try {
      const metadataDir = options.config.metadataDir ?? '.jeeves-metadata';
      const SYSTEM_KEYS = [...SYSTEM_METADATA_KEYS];

      for await (const point of vectorStore.scroll()) {
        const payload = point.payload;
        const filePath = payload['file_path'];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        // Persist only enrichment-ish fields, not chunking/index fields.
        const enrichment = omit(payload, SYSTEM_KEYS);

        await writeMetadata(filePath, metadataDir, enrichment);
      }

      return await reply.status(200).send({ ok: true });
    } catch (error) {
      logger.error({ error }, 'Rebuild metadata failed');
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post<{ Body: { scope?: 'rules' | 'full' } }>(
    '/config-reindex',
    async (request, reply) => {
      try {
        const scope = request.body.scope ?? 'rules';

        // Return immediately and run async
        void (async () => {
          try {
            if (scope === 'rules') {
              // Re-apply inference rules to all files, update Qdrant payloads (no re-embedding)
              const count = await processAllFiles(
                options.config.watch.paths,
                options.config.watch.ignored,
                processor,
                'processRulesUpdate',
              );

              logger.info(
                { scope, filesProcessed: count },
                'Config reindex (rules) completed',
              );
            } else {
              // Full reindex: re-extract, re-embed, re-upsert
              const count = await processAllFiles(
                options.config.watch.paths,
                options.config.watch.ignored,
                processor,
                'processFile',
              );

              logger.info(
                { scope, filesProcessed: count },
                'Config reindex (full) completed',
              );
            }
          } catch (error) {
            logger.error({ error, scope }, 'Config reindex failed');
          }
        })();

        return await reply.status(200).send({ status: 'started', scope });
      } catch (error) {
        logger.error({ error }, 'Config reindex request failed');
        return await reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  return app;
}
