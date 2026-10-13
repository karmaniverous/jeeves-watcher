/**
 * @module api/reapplyRules
 * Re-applies the current inference rules (no re-embedding) to indexed files whose path matches globs: scrolls Qdrant with a `file_path` projection, then calls the processor per file. Qdrant reads plus processor calls.
 */

import picomatch from 'picomatch';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../processor';
import { FIELD_FILE_PATH } from '../processor/payloadFields';
import { normalizeError } from '../util/normalizeError';
import { normalizeSlashes } from '../util/normalizeSlashes';
import type { VectorStore } from '../vectorStore';

/** Scroll page size while collecting indexed file paths. */
const SCROLL_PAGE_SIZE = 256;

/** Outcome of {@link reapplyRules}. */
export interface ReapplyOutcome {
  /** Distinct indexed files whose path matched. */
  matched: number;
  /** Files whose points were updated. */
  updated: number;
}

/**
 * Collect the distinct indexed file paths matching a predicate (projection:
 * `file_path` only; source points carry none and never match).
 *
 * @param vectorStore - The vector store.
 * @param isMatch - Path predicate.
 * @returns Matching file paths.
 */
async function matchingFilePaths(
  vectorStore: Pick<VectorStore, 'scrollPage'>,
  isMatch: (path: string) => boolean,
): Promise<Set<string>> {
  const files = new Set<string>();
  let cursor: string | number | undefined;
  do {
    const page = await vectorStore.scrollPage(
      undefined,
      SCROLL_PAGE_SIZE,
      cursor,
      [FIELD_FILE_PATH],
    );
    for (const { payload } of page.points) {
      const filePath = payload[FIELD_FILE_PATH];
      if (typeof filePath === 'string' && isMatch(filePath)) {
        files.add(filePath);
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return files;
}

/**
 * Re-apply the current rules to every indexed file matching `globs`
 * (slashes normalised, case-insensitive, dotfiles included). A file whose
 * update throws is logged and skipped.
 *
 * @param vectorStore - The vector store.
 * @param processor - The document processor.
 * @param globs - Path globs (non-empty).
 * @param logger - Logger.
 * @returns Matched and updated file counts.
 */
export async function reapplyRules(
  vectorStore: Pick<VectorStore, 'scrollPage'>,
  processor: Pick<DocumentProcessorInterface, 'processRulesUpdate'>,
  globs: readonly string[],
  logger: pino.Logger,
): Promise<ReapplyOutcome> {
  const normalizedGlobs = globs.map((g) => normalizeSlashes(g));
  const isMatch = picomatch(normalizedGlobs, { dot: true, nocase: true });
  const files = await matchingFilePaths(vectorStore, isMatch);

  logger.info(
    { globs: normalizedGlobs, matchCount: files.size },
    'Re-applying rules to matching files',
  );

  let updated = 0;
  for (const filePath of files) {
    try {
      if ((await processor.processRulesUpdate(filePath)) !== null) updated++;
    } catch (error) {
      logger.warn(
        { filePath, err: normalizeError(error) },
        'Failed to re-apply rules to file',
      );
    }
  }
  return { matched: files.size, updated };
}
