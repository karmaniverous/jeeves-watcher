/**
 * @module embedding/healthAlert
 * The embedding health alert (D88, D138): on each transition POST `{ event, at, service, version, host, collection, failingSince, lastError }` to `embedding.alertUrl` (read at each transition) through postWithRetry. Unsigned body: use a private endpoint.
 */

import { hostname } from 'node:os';

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { postWithRetry } from '../util/postWithRetry';
import type { EmbeddingTransition } from './EmbeddingHealth';

/** Options of {@link createEmbeddingAlert}. */
export interface EmbeddingAlertOptions {
  /** The current config (`embedding.alertUrl`, collection name). */
  getConfig: () => Pick<JeevesWatcherConfig, 'embedding' | 'vectorStore'>;
  /** Service version. */
  version: string;
  /** Logger for delivery failures. */
  logger: pino.Logger;
  /** Host name in the body (default `os.hostname()`). */
  host?: string;
}

/** The alert body. */
export interface EmbeddingAlertBody extends EmbeddingTransition {
  /** Always `watcher`. */
  service: 'watcher';
  /** Service version. */
  version: string;
  /** Host name. */
  host: string;
  /** Collection name. */
  collection: string;
}

/**
 * Build the transition handler that sends the alert. Delivery runs in the
 * background (never awaited by the embedding call) and never throws.
 *
 * @param options - Config getter, version, logger, host.
 * @returns The handler, and a way to await deliveries (tests, shutdown).
 */
export function createEmbeddingAlert(options: EmbeddingAlertOptions): {
  onTransition: (transition: EmbeddingTransition) => void;
  settled: () => Promise<void>;
} {
  const host = options.host ?? hostname();
  const pending = new Set<Promise<boolean>>();
  return {
    onTransition: (transition) => {
      const config = options.getConfig();
      const url = config.embedding.alertUrl;
      if (!url) return;
      const body: EmbeddingAlertBody = {
        ...transition,
        service: 'watcher',
        version: options.version,
        host,
        collection: config.vectorStore.collectionName,
      };
      const delivery = postWithRetry(url, { ...body }, options.logger, {
        label: 'Embedding alert',
        logFields: { event: transition.event },
      });
      pending.add(delivery);
      void delivery.finally(() => pending.delete(delivery));
    },
    settled: async () => {
      await Promise.all(pending);
    },
  };
}
