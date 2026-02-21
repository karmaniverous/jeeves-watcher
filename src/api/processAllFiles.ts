/**
 * @module processAllFiles
 *
 * Shared helper for processing all files matching configured globs.
 */

import type { DocumentProcessor } from '../processor';
import { listFilesFromGlobs } from './fileScan';

/**
 * Process all files from globs using the specified processor method.
 *
 * @param watchPaths - The glob patterns to match.
 * @param ignoredPaths - The glob patterns to ignore.
 * @param processor - The document processor instance.
 * @param method - The processor method to call ('processFile' or 'processRulesUpdate').
 * @returns The number of files processed.
 */
export async function processAllFiles(
  watchPaths: string[],
  ignoredPaths: string[] | undefined,
  processor: DocumentProcessor,
  method: 'processFile' | 'processRulesUpdate',
): Promise<number> {
  const files = await listFilesFromGlobs(watchPaths, ignoredPaths);

  for (const file of files) {
    // Sequential on purpose to avoid surprising load.
    // Queue integration can come later.
    await processor[method](file);
  }

  return files.length;
}
