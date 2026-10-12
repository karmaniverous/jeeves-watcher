/**
 * @module api/handlers/search
 * Fastify route handler for POST /search. Embeds a query and performs vector store similarity search.
 */

import { searchRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EmbeddingProvider } from '../../embedding';
import type { VectorStore } from '../../vectorStore';
import { parseBody } from './parseBody';
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
  getHybridConfig?: () => HybridSearchConfig | undefined;
}

type SearchRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /search.
 *
 * @param deps - Route dependencies.
 */
export function createSearchHandler(deps: SearchRouteDeps) {
  return wrapHandler(
    async (request: SearchRequest, reply: FastifyReply) => {
      const body = parseBody(searchRequestSchema, request.body, reply);
      if (!body) return;
      const { query, limit = 10, offset, filter } = body;
      const vectors = await deps.embeddingProvider.embed([query]);

      const hybridConfig = deps.getHybridConfig?.();
      if (hybridConfig?.enabled) {
        return deps.vectorStore.hybridSearch(
          vectors[0],
          query,
          limit,
          hybridConfig.textWeight,
          filter,
          offset,
        );
      }

      return deps.vectorStore.search(vectors[0], limit, filter, offset);
    },
    deps.logger,
    'Search',
  );
}
