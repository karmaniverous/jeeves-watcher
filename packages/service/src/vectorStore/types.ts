/**
 * @module vectorStore/types
 * Vector store interface and type definitions.
 */

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

/** Payload field schema information as reported by Qdrant. */
export interface PayloadFieldSchema {
  /** Qdrant data type for the field (e.g. `keyword`, `text`, `integer`). */
  type: string;
}

/**
 * Collection stats and payload schema information.
 */
export interface CollectionInfo {
  /** Total number of points in the collection. */
  pointCount: number;
  /** Vector dimensions for the collection's configured vector params. */
  dimensions: number;
  /** Payload field schema keyed by field name. */
  payloadFields: Record<string, PayloadFieldSchema>;
}

/**
 * Abstract interface for vector store operations.
 *
 * Enables dependency inversion and easier testing.
 */
export interface VectorStore {
  /**
   * Ensure the collection exists with correct configuration.
   */
  ensureCollection(): Promise<void>;

  /**
   * Upsert points into the collection.
   *
   * @param points - The points to upsert.
   */
  upsert(points: VectorPoint[]): Promise<void>;

  /**
   * Delete points by their IDs.
   *
   * @param ids - The point IDs to delete.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Set payload fields for the specified point IDs.
   *
   * @param ids - Point IDs to update.
   * @param payload - Payload fields to set.
   */
  setPayload(ids: string[], payload: Record<string, unknown>): Promise<void>;

  /**
   * Get the payload of a point by ID.
   *
   * @param id - The point ID.
   * @returns The payload, or `null` if the point doesn't exist.
   */
  getPayload(id: string): Promise<Record<string, unknown> | null>;

  /**
   * Get collection info including point count, dimensions, and payload field schema.
   */
  getCollectionInfo(): Promise<CollectionInfo>;

  /**
   * Search for similar vectors.
   *
   * @param vector - The query vector.
   * @param limit - Maximum results to return.
   * @param filter - Optional Qdrant filter.
   * @param offset - Optional result offset.
   * @returns An array of search results.
   */
  search(
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
    offset?: number,
  ): Promise<SearchResult[]>;

  /**
   * Scroll through all points matching a filter.
   *
   * @param filter - Optional Qdrant filter.
   * @param limit - Page size for scrolling.
   * @yields Scrolled points.
   */
  scroll(
    filter?: Record<string, unknown>,
    limit?: number,
  ): AsyncGenerator<ScrolledPoint>;
}
