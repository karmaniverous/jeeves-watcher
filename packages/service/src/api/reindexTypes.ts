/**
 * @module api/reindexTypes
 * Dependency and result types shared by executeReindex and its per-scope modules (prune, file scopes). Types only, no I/O.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { IssuesFile } from '../issues/types';
import type { DocumentProcessorInterface } from '../processor';
import type { PausableQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import type { ReindexPlan } from './reindexPlan';
import type { ReindexTracker } from './ReindexTracker';

/** Dependencies for executeReindex. */
export interface ExecuteReindexDeps {
  /** Config snapshot for this run (watch paths, reindex settings). */
  config: JeevesWatcherConfig;
  /** Document processor the files (and source documents) go through. */
  processor: DocumentProcessorInterface;
  /** Logger. */
  logger: pino.Logger;
  /** Progress tracker reported by `GET /status`. */
  reindexTracker?: ReindexTracker;
  /** Values index, cleared by scope `full`. */
  valuesManager?: ValuesManager;
  /** Issues store read by scope `issues`. */
  issuesManager?: { getAll: () => IssuesFile };
  /** Gitignore filter applied to listed files and path targets. */
  gitignoreFilter?: GitignoreFilter;
  /** Vector store (required by prune; source discovery reads it). */
  vectorStore?: VectorStoreClient;
  /** File event queue, paused for the duration of a prune. */
  queue?: PausableQueue;
  /**
   * Source notify queue: source documents of a reindex are processed through
   * it (`processNow`), so a reindex and a notification of the same
   * reference never run in parallel. Sources are skipped without it.
   */
  sourceQueue?: Pick<SourceNotifyQueue, 'processNow'>;
  /**
   * Cover source documents in scopes `full`, `rules` and `issues`. Set only
   * by an explicit `POST /reindex`; config-triggered reindexes (reload,
   * config apply, rule registration) leave it unset and stay file-only
   * (Decision 16.11).
   */
  includeSources?: boolean;
}

/**
 * Long-lived reindex dependencies: {@link ExecuteReindexDeps} with a live
 * config getter in place of the per-run snapshot. Route and trigger deps
 * extend this; `reindexDepsFrom` snapshots it for one run.
 */
export type ReindexDepsSource = Omit<
  ExecuteReindexDeps,
  'config' | 'includeSources'
> & {
  /** Live config getter, read once per run. */
  getConfig: () => JeevesWatcherConfig;
};

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
  /** Files processed. */
  filesProcessed: number;
  /** Wall time of the run (0 for a dry run). */
  durationMs: number;
  /** Files and source documents that failed (1 when the run itself failed). */
  errors: number;
  /** The blast-area plan. */
  plan?: ReindexPlan;
  /** Source-document counts, when the run covered sources. */
  sources?: SourceReindexCounts;
}
