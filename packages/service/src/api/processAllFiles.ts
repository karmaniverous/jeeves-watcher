/**
 * @module processAllFiles
 *
 * Shared helper for processing all files matching configured globs.
 */

import { parallel } from 'radash';

import type { DocumentProcessorInterface } from '../processor';
import { listFilesFromGlobs } from './fileScan';

/** Default concurrency limit for reindex operations. */
const DEFAULT_REINDEX_CONCURRENCY = 50;

/** Optional callbacks for progress tracking. */
export interface ProcessAllFilesCallbacks {
  /** Called with the total file count before processing begins. */
  onTotal?: (total: number) => void;
  /** Called after each file is processed. */
  onFileProcessed?: () => void;
}

/**
 * Process all files from globs using the specified processor method.
 *
 * @param watchPaths - The glob patterns to match.
 * @param ignoredPaths - The glob patterns to ignore.
 * @param processor - The document processor instance.
 * @param method - The processor method to call ('processFile' or 'processRulesUpdate').
 * @param concurrency - Maximum concurrent file operations (default 50).
 * @param callbacks - Optional progress tracking callbacks.
 * @returns The number of files processed.
 */
export async function processAllFiles(
  watchPaths: string[],
  ignoredPaths: string[] | undefined,
  processor: DocumentProcessorInterface,
  method: 'processFile' | 'processRulesUpdate',
  concurrency: number = DEFAULT_REINDEX_CONCURRENCY,
  callbacks?: ProcessAllFilesCallbacks,
): Promise<number> {
  const files = await listFilesFromGlobs(watchPaths, ignoredPaths);

  callbacks?.onTotal?.(files.length);

  await parallel(concurrency, files, async (file) => {
    await processor[method](file);
    callbacks?.onFileProcessed?.();
  });

  return files.length;
}
