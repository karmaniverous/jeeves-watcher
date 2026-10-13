/**
 * @module api/handlers/search
 * Fastify route handler for POST /search. Embeds a query through the shared rate limiter (bounded budget; exhaustion → 503) and performs vector store similarity search.
 */

import { searchRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EmbeddingProvider, EmbedOptions } from '../../embedding';
import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import type { VectorStore } from '../../vectorStore';
import { sendError } from '../sendError';
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
 * Query-embedding budget: interactive search fails fast with 503 rather
 * than queueing behind a long rate-limit pause.
 */
const SEARCH_EMBED_BUDGET: EmbedOptions = { attempts: 3, maxWaitMs: 10_000 };

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

      let vectors: number[][];
      try {
        vectors = await deps.embeddingProvider.embed(
          [query],
          SEARCH_EMBED_BUDGET,
        );
      } catch (error) {
        if (!(error instanceof EmbeddingUnavailableError)) throw error;
        deps.logger.warn({ err: error }, 'Search embedding unavailable');
        if (error.retryAfterMs !== undefined) {
          void reply.header(
            'Retry-After',
            String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
          );
        }
        sendError(reply, 503, 'embedding_unavailable', error.name, {
          message: error.message,
        });
        return;
      }

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
