import { QdrantClient } from '@qdrant/js-client-rest';

import type { VectorStoreConfig } from '../config/types';

/**
 * A point to upsert into the vector store.
 */
export interface VectorPoint {
  /** The point ID. */
  id: string;
  /** The embedding vector. */
  vector: number[];
  /** The payload metadata. */
  payload: Record<string, unknown>;
}

/**
 * A search result from the vector store.
 */
export interface SearchResult {
  /** The point ID. */
  id: string;
  /** The similarity score. */
  score: number;
  /** The payload metadata. */
  payload: Record<string, unknown>;
}

/**
 * A scrolled point from the vector store.
 */
export interface ScrolledPoint {
  /** The point ID. */
  id: string;
  /** The payload metadata. */
  payload: Record<string, unknown>;
}

/**
 * Client wrapper for Qdrant vector store operations.
 */
export class VectorStoreClient {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly dims: number;

  /**
   * Create a new VectorStoreClient.
   *
   * @param config - Vector store configuration.
   * @param dimensions - The embedding vector dimensions.
   */
  constructor(config: VectorStoreConfig, dimensions: number) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName;
    this.dims = dimensions;
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
   * Upsert points into the collection.
   *
   * @param points - The points to upsert.
   */
  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  /**
   * Delete points by their IDs.
   *
   * @param ids - The point IDs to delete.
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids,
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
  ): Promise<SearchResult[]> {
    const results = await this.client.search(this.collectionName, {
      vector,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as Record<string, unknown>,
    }));
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
    let offset: string | number | undefined = undefined;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const result = await this.client.scroll(this.collectionName, {
        limit,
        with_payload: true,
        with_vector: false,
        ...(filter ? { filter } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      for (const point of result.points) {
        yield {
          id: String(point.id),
          payload: point.payload as Record<string, unknown>,
        };
      }
      const nextOffset = result.next_page_offset;
      if (nextOffset === null || nextOffset === undefined) {
        break;
      }
      if (typeof nextOffset === 'string' || typeof nextOffset === 'number') {
        offset = nextOffset;
      } else {
        break;
      }
    }
  }
}
