/**
 * @module api/handlers/search
 * Fastify route handler for POST /search. Embeds a query and performs vector store similarity search.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EmbeddingProvider } from '../../embedding';
import type { VectorStoreClient } from '../../vectorStore';

export interface SearchRouteDeps {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStoreClient;
  logger: pino.Logger;
}

type SearchRequest = FastifyRequest<{
  Body: { query: string; limit?: number };
}>;

/**
 * Create handler for POST /search.
 *
 * @param deps - Route dependencies.
 */
export function createSearchHandler(deps: SearchRouteDeps) {
  return async (request: SearchRequest, reply: FastifyReply) => {
    try {
      const { query, limit = 10 } = request.body;
      const vectors = await deps.embeddingProvider.embed([query]);
      const results = await deps.vectorStore.search(vectors[0], limit);
      return results;
    } catch (error) {
      deps.logger.error({ error }, 'Search failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
