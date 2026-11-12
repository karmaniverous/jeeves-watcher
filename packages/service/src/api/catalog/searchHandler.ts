/**
 * @module api/catalog/searchHandler
 * Catalog handler for POST /search: embeds the query through the shared
 * rate limiter (bounded budget; exhaustion is
 * `503 WATCHER_EMBEDDING_UNAVAILABLE` with `Retry-After` when the back-off
 * is known) and performs vector store similarity search, with the request
 * already validated by the catalog's `search` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import { SEARCH_DEFAULT_LIMIT } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EmbeddingProvider, EmbedOptions } from '../../embedding';
import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../filterErrors';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Hybrid search configuration passed to the search handler. */
export interface HybridSearchConfig {
  /** Fuse dense results with full-text matches. */
  enabled: boolean;
  /** Weight of the text results in the fusion (0-1). */
  textWeight: number;
}

/**
 * Query-embedding budget: interactive search fails fast with 503 rather
 * than queueing behind a long rate-limit pause, and uses the rate window's
 * interactive reserve, so indexing never starves it.
 */
export const SEARCH_EMBED_BUDGET: EmbedOptions = {
  attempts: 3,
  maxWaitMs: 10_000,
  interactive: true,
};

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
 * Create the catalog handler for `POST /search`. An embedding failure other
 * than `EmbeddingUnavailableError` is rethrown (a masked 500, logged by
 * jeeves).
 *
 * @param deps - Embedding provider, vector store, logger and hybrid config.
 * @returns The catalog handler.
 */
export function createCatalogSearchHandler(
  deps: CatalogSearchDeps,
): CatalogHandler<Entry<'search'>> {
  return wrapCatalogHandler<Entry<'search'>>(
    async ({ body }) => {
      const { query, limit = SEARCH_DEFAULT_LIMIT, offset, filter } = body;
      const vectors = await deps.embeddingProvider.embed(
        [query],
        SEARCH_EMBED_BUDGET,
      );
      const hybridConfig = deps.getHybridConfig?.();
      const results = await withFilterErrors(
        hybridConfig?.enabled
          ? deps.vectorStore.hybridSearch(
              vectors[0],
              query,
              limit,
              hybridConfig.textWeight,
              filter,
              offset,
            )
          : deps.vectorStore.search(vectors[0], limit, filter, offset),
        deps.logger,
      );
      return { body: results };
    },
    deps.logger,
    'Search',
  );
}
