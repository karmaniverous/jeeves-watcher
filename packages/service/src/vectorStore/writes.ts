/**
 * @module vectorStore/writes
 * Qdrant write operations (upsert, delete, set-payload, delete-payload), each retried under the network retry policy with a fresh client per retry (stale keep-alive connections). Qdrant I/O; sleeps between retries.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import { getLogger, type MinimalLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';
import { NETWORK_RETRY_POLICY, retry, type RetryPolicy } from '../util/retry';
import { deletePointsPayload, setPointsPayload } from './payload';
import type { VectorPoint } from './types';

/** The subset of the Qdrant client used for writes. */
export type WriteClient = Pick<
  QdrantClient,
  'upsert' | 'delete' | 'setPayload' | 'deletePayload'
>;

/** Options of {@link QdrantWriter}. */
export interface QdrantWriterOptions {
  /** Target collection. */
  collectionName: string;
  /** Creates a fresh client (called once up front and again per retry). */
  createClient: () => WriteClient;
  /** Logger for retry warnings. */
  logger?: pino.Logger;
  /** Retry timing. Default: `NETWORK_RETRY_POLICY`. */
  retryPolicy?: RetryPolicy;
}

/**
 * Retrying writer for one collection. Every write uses the shared write
 * client; a retry first replaces it with a fresh client, since the Qdrant
 * client's keep-alive connections go stale (ECONNRESET) while slow embedding
 * calls keep them idle.
 */
export class QdrantWriter {
  private client: WriteClient;
  private readonly log: MinimalLogger;

  /**
   * @param options - Collection, client factory, logger and retry timing.
   */
  constructor(private readonly options: QdrantWriterOptions) {
    this.client = options.createClient();
    this.log = getLogger(options.logger);
  }

  /**
   * Upsert points (no-op when empty).
   *
   * @param points - The points to upsert.
   */
  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.write('upsert', (client, collectionName) =>
      client.upsert(collectionName, {
        wait: true,
        points: points.map(({ id, vector, payload }) => ({
          id,
          vector,
          payload,
        })),
      }),
    );
  }

  /**
   * Delete points by ID (no-op when empty).
   *
   * @param ids - The point IDs to delete.
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.write('delete', (client, collectionName) =>
      client.delete(collectionName, { wait: true, points: ids }),
    );
  }

  /**
   * Merge payload fields into points (no-op when `ids` is empty).
   *
   * @param ids - Point IDs to update.
   * @param payload - Payload fields to set.
   */
  async setPayload(
    ids: string[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.write('setPayload', (client, collectionName) =>
      setPointsPayload(client, collectionName, ids, payload),
    );
  }

  /**
   * Remove payload keys from points (no-op when `ids` or `keys` is empty).
   *
   * @param ids - Point IDs to update.
   * @param keys - Keys to remove.
   */
  async deletePayload(ids: string[], keys: string[]): Promise<void> {
    if (ids.length === 0 || keys.length === 0) return;
    await this.write('deletePayload', (client, collectionName) =>
      deletePointsPayload(client, collectionName, ids, keys),
    );
  }

  /** Run one write under the retry policy, refreshing the client per retry. */
  private async write(
    operation: string,
    fn: (client: WriteClient, collectionName: string) => Promise<unknown>,
  ): Promise<void> {
    const { collectionName, retryPolicy = NETWORK_RETRY_POLICY } = this.options;
    const op = `qdrant.${operation}`;
    await retry(
      async (attempt) => {
        if (attempt > 1) {
          this.log.warn(
            { attempt, operation: op },
            `Retrying Qdrant ${operation}`,
          );
          this.client = this.options.createClient();
          this.options.logger?.info('Created fresh Qdrant client for retry');
        }
        await fn(this.client, collectionName);
      },
      {
        ...retryPolicy,
        onRetry: ({ attempt, delayMs, error }) => {
          this.log.warn(
            { attempt, delayMs, operation: op, err: normalizeError(error) },
            `Qdrant ${operation} failed; will retry`,
          );
        },
      },
    );
  }
}
