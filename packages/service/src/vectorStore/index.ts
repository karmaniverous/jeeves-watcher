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
  facetCounts,
  type FacetHit,
  type FacetRead,
  type FacetStore,
  payloadIndexTypes,
  type RangeBound,
  rangeBound,
  type RangeEnd,
} from './facets';
import {
  ensureTextIndex as ensureTextIndexHelper,
  hybridSearch as hybridSearchHelper,
} from './hybridSearch';
import {
  existingPointIds,
  getPointPayload,
  getPointsWithVectors,
} from './payload';
import { scrollCollection, scrollPage as scrollPageHelper } from './scroll';
import { type SystemIndexState, SystemIndexTracker } from './systemIndexes';
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
  FacetHit,
  FacetRead,
  FacetStore,
  RangeBound,
  RangeEnd,
} from './facets';
export type { SystemIndexState } from './systemIndexes';
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
export class VectorStoreClient implements VectorStore, FacetStore {
  private readonly client: QdrantClient;
  private readonly writer: QdrantWriter;
  private readonly clientConfig: { url: string; apiKey?: string };
  private readonly collectionName: string;
  private readonly dims: number;
  private readonly pinoLogger?: pino.Logger;
  private readonly payloadIndexes: VectorStoreConfig['payloadIndexes'];
  private readonly systemIndexes = new SystemIndexTracker();

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

  /** {@inheritDoc VectorStore.count} */
  async count(filter?: Record<string, unknown>): Promise<number> {
    return countPoints(this.client, this.collectionName, filter);
  }

  /**
   * Ensure the collection exists (Cosine, configured dimensions) and create
   * any missing payload indexes (configured plus `source`/`source_rule`),
   * then start the background system-index builds (D74, D154; not awaited).
   */
  async ensureCollection(): Promise<void> {
    await ensureCollectionHelper(this.client, {
      collectionName: this.collectionName,
      dimensions: this.dims,
      payloadIndexes: this.payloadIndexes,
      logger: this.pinoLogger,
    });
    await this.systemIndexes.start(
      this.createClient(),
      this.collectionName,
      this.pinoLogger,
    );
  }

  /** @returns Each system index's state (`health.collection.systemIndexes`). */
  systemIndexStates(): Record<string, SystemIndexState> {
    return this.systemIndexes.snapshot();
  }

  /**
   * @param field - A system index field (`chunk_index`, `matched_rules`, ...).
   * @returns Its state, or undefined before startup.
   */
  systemIndexState(field: string): SystemIndexState | undefined {
    return this.systemIndexes.state(field);
  }

  /** {@inheritDoc FacetStore.facetCounts} */
  async facetCounts(read: FacetRead, limit: number): Promise<FacetHit[]> {
    return facetCounts(this.client, this.collectionName, read, limit);
  }

  /** {@inheritDoc FacetStore.rangeBound} */
  async rangeBound(read: FacetRead, end: RangeEnd): Promise<RangeBound> {
    return rangeBound(this.client, this.collectionName, read, end);
  }

  /** {@inheritDoc FacetStore.payloadIndexTypes} */
  async payloadIndexTypes(): Promise<Record<string, string>> {
    return payloadIndexTypes(this.client, this.collectionName);
  }

  /** @returns A promise settling once the background index builds end. */
  whenSystemIndexesSettled(): Promise<void> {
    return this.systemIndexes.whenSettled();
  }

  /** {@inheritDoc VectorStore.keywordIndexReady} */
  keywordIndexReady(field: string): boolean {
    return this.systemIndexes.keywordIndexReady(field);
  }

  /** {@inheritDoc VectorStore.setPayloadWhere} */
  async setPayloadWhere(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.writer.setPayloadWhere(filter, payload);
  }

  /** {@inheritDoc VectorStore.deletePayloadWhere} */
  async deletePayloadWhere(
    filter: Record<string, unknown>,
    keys: string[],
  ): Promise<void> {
    await this.writer.deletePayloadWhere(filter, keys);
  }

  /** {@inheritDoc VectorStore.existingIds} */
  async existingIds(ids: string[]): Promise<string[]> {
    return existingPointIds(this.client, this.collectionName, ids);
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

  /** {@inheritDoc VectorStore.getPayload} */
  async getPayload(id: string): Promise<Record<string, unknown> | null> {
    return getPointPayload(this.client, this.collectionName, id);
  }

  /** {@inheritDoc VectorStore.getCollectionInfo} */
  async getCollectionInfo(): Promise<CollectionInfo> {
    return getCollectionInfoHelper(this.client, this.collectionName);
  }

  /** {@inheritDoc VectorStore.search} */
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

  /** {@inheritDoc VectorStore.ensureTextIndex} */
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

  /** {@inheritDoc VectorStore.hybridSearch} */
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

  /** {@inheritDoc VectorStore.getPointsWithVectors} */
  async getPointsWithVectors(ids: string[]): Promise<VectorPoint[]> {
    return getPointsWithVectors(this.client, this.collectionName, ids);
  }

  /** {@inheritDoc VectorStore.scrollPage} */
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

  /** {@inheritDoc VectorStore.scroll} */
  async *scroll(
    filter?: Record<string, unknown>,
    limit = 100,
  ): AsyncGenerator<ScrolledPoint> {
    yield* scrollCollection(this.client, this.collectionName, filter, limit);
  }
}
