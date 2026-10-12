/**
 * @module api/prunePlan
 * Computes the prune plan: scrolls Qdrant (file_path + source, with retry/resume), classifies orphaned file points, never selects source points. I/O: Qdrant scroll, fs.access.
 */

import { access } from 'node:fs/promises';

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored, type GitignoreFilter } from '../gitignore';
import { normalizeError } from '../util/normalizeError';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { normalizePathCase } from '../vcs/gitExec';
import type { ScrolledPoint, VectorStoreClient } from '../vectorStore';
import { listFilesFromGlobs } from './fileScan';
import { groupByRoot, type ReindexPlan } from './reindexPlan';

/** Dependencies of {@link computePrunePlan}. */
export interface PrunePlanDeps {
  /** Service config (watch paths and ignores). */
  config: JeevesWatcherConfig;
  /** Vector store (required). */
  vectorStore?: VectorStoreClient;
  /** Gitignore filter. */
  gitignoreFilter?: GitignoreFilter;
  /** Logger. */
  logger: pino.Logger;
}

/** Default page size for prune scroll (smaller than search to reduce connection strain). */
const PRUNE_SCROLL_PAGE_SIZE = 500;

/** Max retry attempts for scroll page failures. */
const SCROLL_RETRY_ATTEMPTS = 5;

/** Base delay for scroll retry backoff (ms). */
const SCROLL_RETRY_BASE_DELAY_MS = 1000;

/**
 * Scroll one page with retry/resume on connection failure.
 * On failure, retries with exponential backoff from the same cursor.
 */
async function scrollPageWithRetry(
  vectorStore: VectorStoreClient,
  cursor: string | number | undefined,
  logger: pino.Logger,
): Promise<{ points: ScrolledPoint[]; nextCursor?: string | number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SCROLL_RETRY_ATTEMPTS; attempt++) {
    try {
      const page = await vectorStore.scrollPage(
        undefined,
        PRUNE_SCROLL_PAGE_SIZE,
        cursor,
        ['file_path', 'source'],
      );
      return { points: page.points, nextCursor: page.nextCursor };
    } catch (error) {
      lastError = error;
      if (attempt < SCROLL_RETRY_ATTEMPTS) {
        const delay =
          SCROLL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) +
          Math.random() * 500;
        logger.warn(
          { attempt, err: normalizeError(error) },
          `Prune scroll page failed; retrying in ${String(Math.round(delay))}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/** Concurrency limit for fs.access() disk-existence checks. */
const FS_ACCESS_CONCURRENCY = 100;

/**
 * Compute the plan for a prune operation using a filter-first approach.
 *
 * 1. Enumerate all watched files from the filesystem → `watchedFiles` set.
 * 2. Scroll Qdrant points (`file_path` and `source`). For each point:
 *    - Carries `source` → never selected (source documents are not files).
 *    - No `file_path` → orphan.
 *    - `file_path` not in `watchedFiles` → orphan (out of watch scope).
 *    - `file_path` in `watchedFiles` → check disk existence via `fs.access()`.
 *      If missing from disk → orphan (deleted file still in index).
 * 3. Batch `fs.access()` checks with bounded concurrency.
 */
export async function computePrunePlan(
  deps: PrunePlanDeps,
): Promise<{ plan: ReindexPlan; orphanedIds: string[] }> {
  const { config, vectorStore, gitignoreFilter, logger } = deps;

  if (!vectorStore) {
    throw new Error('vectorStore is required for prune scope');
  }

  // Step 1: Build set of watched files from filesystem
  const isGitignored = createIsGitignored(gitignoreFilter);
  const watchedFileList = await listFilesFromGlobs(
    extractWatchPathStrings(config.watch.paths),
    config.watch.ignored,
    isGitignored,
  );
  const watchedFiles = new Set(
    watchedFileList.map((f) => normalizePathCase(normalizeSlashes(f))),
  );
  logger.info(
    { watchedFileCount: watchedFiles.size },
    'Prune: enumerated watched files from filesystem',
  );

  // Step 2: Scroll Qdrant and classify points
  const seenFiles = new Set<string>();
  const orphanedFiles = new Set<string>();
  const diskCheckFiles = new Set<string>();
  const orphanedIds: string[] = [];
  // Map from file_path → point IDs, for points needing disk-existence check
  const diskCheckPointIds = new Map<string, string[]>();
  let totalPoints = 0;
  let incomplete = false;
  let cursor: string | number | undefined;

  try {
    let hasMore = true;
    while (hasMore) {
      const page = await scrollPageWithRetry(vectorStore, cursor, logger);

      for (const point of page.points) {
        totalPoints++;
        // Prune guard (row 27): source points are never pruned.
        if (point.payload.source !== undefined) continue;
        const filePath = point.payload.file_path as string | undefined;
        if (!filePath) {
          orphanedIds.push(point.id);
          continue;
        }

        const normalized = normalizePathCase(normalizeSlashes(filePath));

        if (seenFiles.has(normalized)) {
          if (orphanedFiles.has(normalized)) {
            orphanedIds.push(point.id);
          } else if (diskCheckFiles.has(normalized)) {
            // Already queued for disk check — track its ID
            const ids = diskCheckPointIds.get(normalized);
            if (ids) ids.push(point.id);
          }
          continue;
        }

        seenFiles.add(normalized);

        if (!watchedFiles.has(normalized)) {
          // Not in watch scope → definitely orphaned
          orphanedFiles.add(normalized);
          orphanedIds.push(point.id);
        } else {
          // In watch scope → needs disk-existence check
          diskCheckFiles.add(normalized);
          diskCheckPointIds.set(normalized, [point.id]);
        }
      }

      // Progress logging every 100K points
      if (totalPoints > 0 && totalPoints % 100000 === 0) {
        logger.info(
          { totalPoints, orphanedCount: orphanedIds.length },
          'Prune scroll progress',
        );
      }

      if (!page.nextCursor) {
        hasMore = false;
      } else {
        cursor = page.nextCursor;
      }
    }
  } catch (error) {
    logger.error(
      { err: normalizeError(error), totalPoints, cursor },
      'Prune scroll failed after retries; returning partial plan',
    );
    incomplete = true;
  }

  // Step 3: Batch fs.access() checks for files in watch scope
  const filesToCheck = [...diskCheckFiles];
  await parallel(FS_ACCESS_CONCURRENCY, filesToCheck, async (filePath) => {
    try {
      await access(filePath);
    } catch {
      // File doesn't exist on disk → orphaned
      orphanedFiles.add(filePath);
      const pointIds = diskCheckPointIds.get(filePath);
      if (pointIds) {
        orphanedIds.push(...pointIds);
      }
    }
  });

  const orphanedFileList = [...orphanedFiles];
  const byRoot = groupByRoot(
    orphanedFileList,
    extractWatchPathStrings(config.watch.paths),
  );

  return {
    plan: {
      total: totalPoints,
      toProcess: 0,
      toDelete: orphanedIds.length,
      byRoot,
      ...(incomplete ? { incomplete: true } : {}),
    },
    orphanedIds,
  };
}
