import { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import type { VectorStoreConfig } from '../config/types';
import { getLogger, type MinimalLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import { getCollectionInfo as getCollectionInfoHelper } from './collectionInfo';
import {
  ensureTextIndex as ensureTextIndexHelper,
  hybridSearch as hybridSearchHelper,
} from './hybridSearch';
import { scrollCollection } from './scroll';
import type {
  CollectionInfo,
  ScrolledPoint,
  SearchResult,
  VectorPoint,
  VectorStore,
} from './types';

// Re-export types for public API
export type {
  CollectionInfo,
  PayloadFieldSchema,
  ScrolledPoint,
  SearchResult,
  VectorPoint,
  VectorStore,
} from './types';

/**
 * Client wrapper for Qdrant vector store operations.
 *
 * Implements the {@link VectorStore} interface for dependency inversion.
 */
export class VectorStoreClient implements VectorStore {
  private readonly client: QdrantClient;
  private readonly clientConfig: { url: string; apiKey?: string };
  private readonly collectionName: string;
  private readonly dims: number;
  private readonly log: MinimalLogger;
  private readonly pinoLogger?: pino.Logger;

  /**
   * Create a new VectorStoreClient.
   *
   * @param config - Vector store configuration.
   * @param dimensions - The embedding vector dimensions.
   * @param logger - Optional pino logger for retry warnings.
   */
  constructor(
    config: VectorStoreConfig,
    dimensions: number,
    logger?: pino.Logger,
  ) {
    this.clientConfig = { url: config.url, apiKey: config.apiKey };
    this.client = this.createClient();
    this.collectionName = config.collectionName;
    this.dims = dimensions;
    this.log = getLogger(logger);
    this.pinoLogger = logger;
  }

  /**
   * Create a fresh QdrantClient instance.
   *
   * Used to avoid stale HTTP keep-alive connections. The Qdrant JS client's
   * internal undici Agent uses keepAliveTimeout: 10s, which causes ECONNRESET
   * when connections sit idle during slow embedding calls (Gemini p99 ~8s).
   * Creating a fresh client for write operations ensures clean TCP connections.
   */
  private createClient(): QdrantClient {
    return new QdrantClient({
      ...this.clientConfig,
      checkCompatibility: false,
    });
  }

  /**
   * Ensure the collection exists with correct dimensions and Cosine distance.
   */
  /**
   * Count points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @returns The number of matching points.
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    const result = await this.client.count(this.collectionName, {
      ...(filter ? { filter } : {}),
      exact: true,
    });
    return result.count;
  }

  /**
   * Ensure the collection exists with correct dimensions and Cosine distance.
   */
  async ensureCollection(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName,
      );
      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: this.dims, distance: 'Cosine' },
        });
      }
    } catch (error) {
      throw new Error(
        `Failed to ensure collection "${this.collectionName}": ${String(error)}`,
      );
    }
  }

  /**
   * Retry a Qdrant operation with standardized config and logging.
   *
   * @param operation - Operation name for logging (e.g., 'upsert', 'delete').
   * @param fn - Async function to retry.
   */
  private async retryOperation(
    operation: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    await retry(
      async (attempt) => {
        if (attempt > 1) {
          this.log.warn(
            { attempt, operation: `qdrant.${operation}` },
            `Retrying Qdrant ${operation}`,
          );
        }
        await fn();
      },
      {
        attempts: 5,
        baseDelayMs: 500,
        maxDelayMs: 10_000,
        jitter: 0.2,
        onRetry: ({ attempt, delayMs, error }) => {
          this.log.warn(
            {
              attempt,
              delayMs,
              operation: `qdrant.${operation}`,
              err: normalizeError(error),
            },
            `Qdrant ${operation} failed; will retry`,
          );
        },
      },
    );
  }

  /**
   * Upsert points into the collection.
   *
   * Uses a fresh QdrantClient per attempt to avoid stale keep-alive connections.
   * Between embedding calls and upserts, idle connections may be closed by the
   * server, causing ECONNRESET on reuse.
   *
   * @param points - The points to upsert.
   */
  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    await this.retryOperation('upsert', async () => {
      const freshClient = this.createClient();
      await freshClient.upsert(this.collectionName, {
        wait: true,
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
    });
  }

  /**
   * Delete points by their IDs.
   *
   * Uses a fresh QdrantClient per attempt to avoid stale keep-alive connections.
   *
   * @param ids - The point IDs to delete.
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.retryOperation('delete', async () => {
      const freshClient = this.createClient();
      await freshClient.delete(this.collectionName, {
        wait: true,
        points: ids,
      });
    });
  }

  /**
   * Set payload fields for the specified point IDs.
   *
   * This merges the given payload object into each point's existing payload.
   *
   * @param ids - Point IDs to update.
   * @param payload - Payload fields to set.
   */
  async setPayload(
    ids: string[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.client.setPayload(this.collectionName, {
      wait: true,
      points: ids,
      payload,
    });
  }

  /**
   * Get the payload of a point by ID.
   *
   * @param id - The point ID.
   * @returns The payload, or `null` if the point doesn't exist.
   */
  async getPayload(id: string): Promise<Record<string, unknown> | null> {
    try {
      const results = await this.client.retrieve(this.collectionName, {
        ids: [id],
        with_payload: true,
        with_vector: false,
      });
      if (results.length === 0) return null;
      return results[0].payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Get collection info including point count, dimensions, and payload field schema.
   *
   * When Qdrant has payload indexes, uses `payload_schema` directly. Otherwise
   * samples points to discover fields and infer types.
   */
  async getCollectionInfo(): Promise<CollectionInfo> {
    return getCollectionInfoHelper(this.client, this.collectionName);
  }

  /**
   * Search for similar vectors.
   *
   * @param vector - The query vector.
   * @param limit - Maximum results to return.
   * @param filter - Optional Qdrant filter.
   * @returns An array of search results.
   */
  async search(
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
    offset?: number,
  ): Promise<SearchResult[]> {
    const results = await this.client.search(this.collectionName, {
      vector,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as Record<string, unknown>,
    }));
  }

  /**
   * Create a full-text payload index on the specified field.
   * Idempotent — skips if the field already has a text index.
   *
   * @param fieldName - The payload field to index.
   */
  async ensureTextIndex(fieldName: string): Promise<void> {
    if (!this.pinoLogger) {
      throw new Error('Logger required for ensureTextIndex');
    }
    await ensureTextIndexHelper(
      this.client,
      this.collectionName,
      fieldName,
      this.pinoLogger,
    );
  }

  /**
   * Hybrid search combining dense vector and full-text match with RRF fusion.
   *
   * @param vector - The query vector.
   * @param queryText - The raw query text for full-text matching.
   * @param limit - Maximum results to return.
   * @param textWeight - Weight for text results in RRF (0–1).
   * @param filter - Optional Qdrant filter.
   * @returns An array of search results.
   */
  async hybridSearch(
    vector: number[],
    queryText: string,
    limit: number,
    textWeight: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    return hybridSearchHelper(
      this.client,
      this.collectionName,
      vector,
      queryText,
      limit,
      textWeight,
      filter,
    );
  }

  /**
   * Scroll through all points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @param limit - Page size for scrolling.
   * @yields Scrolled points.
   */
  /**
   * Scroll one page of points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @param limit - Page size.
   * @param offset - Cursor offset from previous page.
   * @param fields - Optional field projection.
   * @returns Page of points and next cursor.
   */
  async scrollPage(
    filter?: Record<string, unknown>,
    limit = 100,
    offset?: string | number,
    fields?: string[],
  ): Promise<{ /** Matched points. */ points: ScrolledPoint[]; /** Cursor for next page. */ nextCursor?: string | number }> {
    const result = await this.client.scroll(this.collectionName, {
      limit,
      with_payload: fields ? fields : true,
      with_vector: false,
      ...(filter ? { filter } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return {
      points: result.points.map((p) => ({
        id: String(p.id),
        payload: p.payload as Record<string, unknown>,
      })),
      nextCursor:
        typeof result.next_page_offset === 'string' ||
        typeof result.next_page_offset === 'number'
          ? result.next_page_offset
          : undefined,
    };
  }

  /**
   * Scroll through all points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @param limit - Page size for scrolling.
   * @yields Scrolled points.
   */
  async *scroll(
    filter?: Record<string, unknown>,
    limit = 100,
  ): AsyncGenerator<ScrolledPoint> {
    yield* scrollCollection(this.client, this.collectionName, filter, limit);
  }
}
