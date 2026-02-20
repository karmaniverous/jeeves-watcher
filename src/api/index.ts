import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import { writeMetadata } from '../metadata';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import type { VectorStoreClient } from '../vectorStore';
import { listFilesFromGlobs } from './fileScan';

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
      const files = await listFilesFromGlobs(
        options.config.watch.paths,
        options.config.watch.ignored,
      );

      for (const file of files) {
        // Sequential on purpose to avoid surprising load.
        // Queue integration can come later.
        await processor.processFile(file);
      }

      return await reply
        .status(200)
        .send({ ok: true, filesIndexed: files.length });
    } catch (error) {
      logger.error({ error }, 'Reindex failed');
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/rebuild-metadata', async (_request, reply) => {
    try {
      const metadataDir = options.config.metadataDir ?? '.jeeves-metadata';

      for await (const point of vectorStore.scroll()) {
        const payload = point.payload;
        const filePath = payload['file_path'];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        // Persist only enrichment-ish fields, not chunking/index fields.
        const rest: Record<string, unknown> = { ...payload };
        delete rest.file_path;
        delete rest.chunk_index;
        delete rest.total_chunks;
        delete rest.content_hash;
        delete rest.chunk_text;

        await writeMetadata(filePath, metadataDir, rest);
      }

      return await reply.status(200).send({ ok: true });
    } catch (error) {
      logger.error({ error }, 'Rebuild metadata failed');
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/config-reindex', async (_request, reply) => {
    return await reply.status(501).send({ error: 'Not implemented' });
  });

  return app;
}
