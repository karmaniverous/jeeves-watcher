/**
 * @module app/stateStores
 * The service's state stores, created once per start: issues, values and enrichment under `stateDir`, the content-hash cache, and the per-document locks shared by the processor and the API (D98). Constructors only; the stores do their own I/O.
 */

import { ROOT_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { ContentHashCache } from '../cache';
import type { JeevesWatcherConfig } from '../config/types';
import { EnrichmentStore } from '../enrichment';
import { IssuesManager } from '../issues';
import { DocumentLocks } from '../processor/DocumentLocks';
import { ValuesManager } from '../values';

/** The state stores of one running service. */
export interface StateStores {
  /** Issues (`issues.json`). */
  issuesManager: IssuesManager;
  /** Distinct metadata values (`values.v8`). */
  valuesManager: ValuesManager;
  /** Enrichment metadata (`enrichments.sqlite`). */
  enrichmentStore: EnrichmentStore;
  /** In-memory content hashes (unchanged-file detection). */
  contentHashCache: ContentHashCache;
  /** Per-document locks: the processor's, also taken by API handlers. */
  documentLocks: DocumentLocks;
}

/**
 * Create the state stores for a start.
 *
 * @param config - The resolved configuration (`stateDir`).
 * @param logger - The service logger.
 * @returns The stores.
 */
export function createStateStores(
  config: JeevesWatcherConfig,
  logger: pino.Logger,
): StateStores {
  const stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
  return {
    issuesManager: new IssuesManager(stateDir, logger),
    valuesManager: new ValuesManager(stateDir, logger),
    enrichmentStore: new EnrichmentStore(stateDir, logger),
    contentHashCache: new ContentHashCache(),
    documentLocks: new DocumentLocks(logger),
  };
}
