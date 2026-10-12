/**
 * @module api/reindexTypes
 * Dependency and result types shared by executeReindex and its per-scope modules (prune, file scopes). Types only, no I/O.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import type { PausableQueue } from '../queue';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import type { ReindexPlan } from './reindexPlan';
import type { ReindexTracker } from './ReindexTracker';

/** Dependencies for executeReindex. */
export interface ExecuteReindexDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker?: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: { getAll: () => Record<string, unknown> };
  gitignoreFilter?: GitignoreFilter;
  vectorStore?: VectorStoreClient;
  queue?: PausableQueue;
  /**
   * Cover source documents in scopes `full`, `rules` and `issues`. Set only
   * by an explicit `POST /reindex`; config-triggered reindexes (reload,
   * config apply, rule registration) leave it unset and stay file-only
   * (Decision 16.11).
   */
  includeSources?: boolean;
}

/** Per-status counts of a source-document reindex. */
export interface SourceReindexCounts {
  /** Re-embedded, or payload refreshed. */
  indexed: number;
  /** Nothing changed. */
  unchanged: number;
  /** Callback answered 404; points deleted. */
  deleted: number;
  /** Failure recorded as an issue; points untouched. */
  failed: number;
}

/** Result of a reindex execution. */
export interface ExecuteReindexResult {
  filesProcessed: number;
  durationMs: number;
  errors: number;
  plan?: ReindexPlan;
  /** Source-document counts, when the run covered sources. */
  sources?: SourceReindexCounts;
}
