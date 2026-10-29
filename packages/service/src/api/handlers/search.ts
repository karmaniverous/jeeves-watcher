/**
 * @module api/handlers/search
 * Fastify route handler for POST /search. Embeds a query through the shared rate limiter (bounded budget; exhaustion → 503) and performs vector store similarity search.
 */

import {
  SEARCH_DEFAULT_LIMIT,
  searchRequestSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EmbeddingProvider, EmbedOptions } from '../../embedding';
import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../requestError';
import { sendError } from '../sendError';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Hybrid search configuration passed to the search handler. */
export interface HybridSearchConfig {
  /** Fuse dense results with full-text matches. */
  enabled: boolean;
  /** Weight of the text results in the fusion (0-1). */
  textWeight: number;
}

/** Dependencies of the POST /search handler. */
export interface SearchRouteDeps {
  /** Embeds the query (the shared, rate-limited provider). */
  embeddingProvider: EmbeddingProvider;
  /** Vector store searched. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** Live hybrid search settings (read per request), if any. */
  getHybridConfig?: () => HybridSearchConfig | undefined;
}

type SearchRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Query-embedding budget: interactive search fails fast with 503 rather
 * than queueing behind a long rate-limit pause.
 */
export const SEARCH_EMBED_BUDGET: EmbedOptions = {
  attempts: 3,
  maxWaitMs: 10_000,
};

/**
 * `Retry-After` header value (whole seconds, at least 1) for a known
 * embedding retry delay. Pure.
 *
 * @param retryAfterMs - Retry delay in milliseconds.
 * @returns The header value.
 */
export function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

/**
 * Create handler for POST /search. A filter Qdrant rejects is
 * `400 invalid_request`; an exhausted embedding budget is
 * `503 embedding_unavailable` (with `Retry-After` when known).
 *
 * @param deps - Route dependencies.
 * @returns Fastify route handler.
 */
export function createSearchHandler(deps: SearchRouteDeps) {
  return wrapHandler(
    async (request: SearchRequest, reply: FastifyReply) => {
      const body = parseBody(searchRequestSchema, request.body);
      const { query, limit = SEARCH_DEFAULT_LIMIT, offset, filter } = body;

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
            retryAfterSeconds(error.retryAfterMs),
          );
        }
        sendError(reply, 'embedding_unavailable', error.name, {
          message: error.message,
        });
        return;
      }

      const hybridConfig = deps.getHybridConfig?.();
      if (hybridConfig?.enabled) {
        return withFilterErrors(
          deps.vectorStore.hybridSearch(
            vectors[0],
            query,
            limit,
            hybridConfig.textWeight,
            filter,
            offset,
          ),
        );
      }

      return withFilterErrors(
        deps.vectorStore.search(vectors[0], limit, filter, offset),
      );
    },
    deps.logger,
    'Search',
  );
}
