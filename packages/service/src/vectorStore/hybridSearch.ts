/**
 * @module vectorStore/hybridSearch
 * Hybrid search and text index helpers for Qdrant vector store.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import type { SearchResult } from './types';

/**
 * Create a full-text payload index on the specified field.
 * Idempotent — skips if the field already has an index.
 *
 * @param client - Qdrant client instance.
 * @param collectionName - Name of the Qdrant collection.
 * @param fieldName - The payload field to index.
 * @param log - Logger instance.
 */
export async function ensureTextIndex(
  client: QdrantClient,
  collectionName: string,
  fieldName: string,
  log: pino.Logger,
): Promise<void> {
  try {
    const info = await client.getCollection(collectionName);
    const existing = info.payload_schema[fieldName];
    if (existing) {
      log.info({ fieldName }, 'Text index already exists, skipping creation');
      return;
    }
  } catch {
    // Collection may not exist yet; proceed to create index anyway.
  }

  try {
    await client.createPayloadIndex(collectionName, {
      field_name: fieldName,
      field_schema: {
        type: 'text',
        tokenizer: 'word',
        min_token_len: 2,
        lowercase: true,
      },
      wait: true,
    });
    log.info({ fieldName }, 'Full-text payload index created');
  } catch (error) {
    throw new Error(
      `Failed to create text index on "${fieldName}": ${String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Hybrid search combining dense vector and full-text match with RRF fusion.
 *
 * Uses Qdrant Query API with two prefetches:
 * 1. Dense vector similarity search
 * 2. Dense vector search filtered to documents matching the query text
 *
 * Results are fused using Reciprocal Rank Fusion (RRF) with configurable weights.
 *
 * @param client - Qdrant client instance.
 * @param collectionName - Name of the Qdrant collection.
 * @param vector - The query vector.
 * @param queryText - The raw query text for full-text matching.
 * @param limit - Maximum results to return.
 * @param textWeight - Weight for text results in RRF (0–1).
 * @param filter - Optional Qdrant filter.
 * @returns An array of search results.
 */
export async function hybridSearch(
  client: QdrantClient,
  collectionName: string,
  vector: number[],
  queryText: string,
  limit: number,
  textWeight: number,
  filter?: Record<string, unknown>,
): Promise<SearchResult[]> {
  const prefetchLimit = Math.max(limit * 3, 20);
  const vectorWeight = 1 - textWeight;

  const textFilter = {
    must: [
      ...(filter ? ((filter as { must?: unknown[] }).must ?? []) : []),
      { key: 'chunk_text', match: { text: queryText } },
    ],
  };

  const result = await client.query(collectionName, {
    prefetch: [
      {
        query: vector,
        limit: prefetchLimit,
        ...(filter ? { filter } : {}),
      },
      {
        query: vector,
        filter: textFilter,
        limit: prefetchLimit,
      },
    ],
    query: {
      rrf: {
        weights: [vectorWeight, textWeight],
      },
    },
    limit,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: String(p.id),
    score: p.score,
    payload: p.payload as Record<string, unknown>,
  }));
}
