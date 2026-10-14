/**
 * @module vectorStore
 * Qdrant-backed {@link VectorStore}: collection setup, retried writes (see `writes`), payload reads, search, hybrid search and scrolling. Qdrant I/O.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import type { VectorStoreConfig } from '../config/types';
import { getCollectionInfo as getCollectionInfoHelper } from './collectionInfo';
import { countPoints } from './count';
import { ensureCollection as ensureCollectionHelper } from './ensureCollection';
import {
  ensureTextIndex as ensureTextIndexHelper,
  hybridSearch as hybridSearchHelper,
} from './hybridSearch';
import { getPointPayload, getPointsWithVectors } from './payload';
import { scrollCollection, scrollPage as scrollPageHelper } from './scroll';
import type {
  CollectionInfo,
  ScrolledPoint,
  ScrollPageResult,
  SearchResult,
  VectorPoint,
  VectorStore,
} from './types';
import { QdrantWriter } from './writes';

// Re-export types for public API
export type {
  CollectionInfo,
  PayloadFieldSchema,
  ScrolledPoint,
  ScrollPageResult,
  SearchResult,
  VectorPoint,
  VectorStore,
} from './types';

/**
 * Client wrapper for Qdrant vector store operations.
 *
 * Implements the {@link VectorStore} interface for dependency inversion.
 * Writes (upsert, delete, set/delete payload) are retried, each retry on a
 * fresh client (see QdrantWriter).
 */
export class VectorStoreClient implements VectorStore {
  private readonly client: QdrantClient;
  private readonly writer: QdrantWriter;
  private readonly clientConfig: { url: string; apiKey?: string };
  private readonly collectionName: string;
  private readonly dims: number;
  private readonly pinoLogger?: pino.Logger;
  private readonly payloadIndexes: VectorStoreConfig['payloadIndexes'];

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
    this.payloadIndexes = config.payloadIndexes;
    this.dims = dimensions;
    this.pinoLogger = logger;
    this.writer = new QdrantWriter({
      collectionName: config.collectionName,
      createClient: () => this.createClient(),
      logger,
    });
  }

  /**
   * Create a fresh QdrantClient instance.
   *
   * Used to avoid stale HTTP keep-alive connections. The Qdrant JS client's
   * internal undici Agent uses keepAliveTimeout: 10s, which causes ECONNRESET
   * when connections sit idle during slow embedding calls (Gemini p99 ~8s).
   * Writes therefore run on their own client, replaced on every retry
   * (see QdrantWriter).
   */
  private createClient(): QdrantClient {
    return new QdrantClient({
      ...this.clientConfig,
      checkCompatibility: false,
    });
  }

  /**
   * Count points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @returns The number of matching points.
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    return countPoints(this.client, this.collectionName, filter);
  }

  /**
   * Ensure the collection exists (Cosine, configured dimensions) and create
   * any missing payload indexes (configured plus `source`/`source_rule`).
   */
  async ensureCollection(): Promise<void> {
    await ensureCollectionHelper(this.client, {
      collectionName: this.collectionName,
      dimensions: this.dims,
      payloadIndexes: this.payloadIndexes,
      logger: this.pinoLogger,
    });
  }

  /** {@inheritDoc VectorStore.upsert} */
  async upsert(points: VectorPoint[]): Promise<void> {
    await this.writer.upsert(points);
  }

  /** {@inheritDoc VectorStore.delete} */
  async delete(ids: string[]): Promise<void> {
    await this.writer.delete(ids);
  }

  /** {@inheritDoc VectorStore.setPayload} */
  async setPayload(
    ids: string[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.writer.setPayload(ids, payload);
  }

  /** {@inheritDoc VectorStore.deletePayload} */
  async deletePayload(ids: string[], keys: string[]): Promise<void> {
    await this.writer.deletePayload(ids, keys);
  }

  /**
   * Get the payload of a point by ID.
   *
   * @param id - The point ID.
   * @returns The payload, or `null` if the point doesn't exist.
   * @throws When the read fails (never reported as a missing point).
   */
  async getPayload(id: string): Promise<Record<string, unknown> | null> {
    return getPointPayload(this.client, this.collectionName, id);
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
    const { points } = await this.client.query(this.collectionName, {
      query: vector,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return points.map((r) => ({
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
   * @param offset - Optional result offset for pagination.
   * @returns An array of search results.
   */
  async hybridSearch(
    vector: number[],
    queryText: string,
    limit: number,
    textWeight: number,
    filter?: Record<string, unknown>,
    offset?: number,
  ): Promise<SearchResult[]> {
    return hybridSearchHelper(
      this.client,
      this.collectionName,
      vector,
      queryText,
      limit,
      textWeight,
      filter,
      offset,
    );
  }

  /**
   * Retrieve points with their vectors by ID.
   *
   * @param ids - The point IDs to retrieve.
   * @returns Points with vectors and payloads; missing IDs are omitted.
   * @throws When the read fails (never reported as missing points).
   */
  async getPointsWithVectors(ids: string[]): Promise<VectorPoint[]> {
    return getPointsWithVectors(this.client, this.collectionName, ids);
  }

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
  ): Promise<ScrollPageResult> {
    return scrollPageHelper(
      this.client,
      this.collectionName,
      filter,
      limit,
      offset,
      fields,
    );
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
