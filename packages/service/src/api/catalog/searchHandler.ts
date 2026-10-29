/**
 * @module api/catalog/searchHandler
 * Catalog handler for POST /search: embeds the query through the shared
 * rate limiter (bounded budget; exhaustion sends 503 with `Retry-After`) and
 * performs vector store similarity search, with the request already
 * validated by the catalog's `search` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import { SEARCH_DEFAULT_LIMIT } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EmbeddingProvider, EmbedOptions } from '../../embedding';
import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { normalizeError } from '../../util/normalizeError';
import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../requestError';
import { INTERNAL_ERROR_MESSAGE } from '../sendError';
import type { Entry } from './catalogEntry';
import { errorResult } from './errorResult';
import { catalogErrorFromThrown } from './wrapCatalogHandler';

/** Hybrid search configuration passed to the search handler. */
export interface HybridSearchConfig {
  /** Fuse dense results with full-text matches. */
  enabled: boolean;
  /** Weight of the text results in the fusion (0-1). */
  textWeight: number;
}

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

/** Dependencies for the catalog `search` entry's handler. */
export interface CatalogSearchDeps {
  /** Embeds the query (the shared, rate-limited provider). */
  embeddingProvider: EmbeddingProvider;
  /** Vector store searched. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** Live hybrid search settings (read per request), if any. */
  getHybridConfig?: () => HybridSearchConfig | undefined;
}

/**
 * Create the catalog handler for `POST /search`.
 *
 * @param deps - Embedding provider, vector store, logger and hybrid config.
 * @returns The catalog handler.
 */
export function createCatalogSearchHandler(
  deps: CatalogSearchDeps,
): CatalogHandler<Entry<'search'>> {
  return async (input) => {
    const { query, limit = SEARCH_DEFAULT_LIMIT, offset, filter } = input.body;

    let vectors: number[][];
    try {
      vectors = await deps.embeddingProvider.embed(
        [query],
        SEARCH_EMBED_BUDGET,
      );
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) {
        deps.logger.error({ err: normalizeError(error) }, 'Search failed');
        return errorResult('internal_error', 'Internal Server Error', {
          message: INTERNAL_ERROR_MESSAGE,
        });
      }
      deps.logger.warn({ err: error }, 'Search embedding unavailable');
      const headers =
        error.retryAfterMs !== undefined
          ? { 'Retry-After': retryAfterSeconds(error.retryAfterMs) }
          : undefined;
      return {
        ...errorResult('embedding_unavailable', error.name, {
          message: error.message,
        }),
        ...(headers ? { headers } : {}),
      };
    }

    try {
      const hybridConfig = deps.getHybridConfig?.();
      const results = hybridConfig?.enabled
        ? await withFilterErrors(
            deps.vectorStore.hybridSearch(
              vectors[0],
              query,
              limit,
              hybridConfig.textWeight,
              filter,
              offset,
            ),
          )
        : await withFilterErrors(
            deps.vectorStore.search(vectors[0], limit, filter, offset),
          );
      return { status: 200, body: results };
    } catch (error) {
      return catalogErrorFromThrown(error, deps.logger, 'Search');
    }
  };
}
