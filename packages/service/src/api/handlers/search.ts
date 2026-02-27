/**
 * @module api/handlers/search
 * Fastify route handler for POST /search. Embeds a query and performs vector store similarity search.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EmbeddingProvider } from '../../embedding';
import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

/** Hybrid search configuration passed to the search handler. */
export interface HybridSearchConfig {
  enabled: boolean;
  textWeight: number;
}

export interface SearchRouteDeps {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  logger: pino.Logger;
  hybridConfig?: HybridSearchConfig;
}

type SearchRequest = FastifyRequest<{
  Body: {
    query: string;
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
  };
}>;

/**
 * Create handler for POST /search.
 *
 * @param deps - Route dependencies.
 */
export function createSearchHandler(deps: SearchRouteDeps) {
  return wrapHandler(
    async (request: SearchRequest) => {
      const { query, limit = 10, offset, filter } = request.body;
      const vectors = await deps.embeddingProvider.embed([query]);

      if (deps.hybridConfig?.enabled) {
        return deps.vectorStore.hybridSearch(
          vectors[0],
          query,
          limit,
          deps.hybridConfig.textWeight,
          filter,
        );
      }

      return deps.vectorStore.search(vectors[0], limit, filter, offset);
    },
    deps.logger,
    'Search',
  );
}
