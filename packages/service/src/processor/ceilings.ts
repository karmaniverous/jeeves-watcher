/**
 * @module processor/ceilings
 * The `processing` ceilings (D44, D64): file size from `stat` before extraction, extracted text bytes, chunk count. Each check returns the `too_large` reason, or `undefined` within bounds; a value equal to its ceiling is allowed.
 */

import { stat } from 'node:fs/promises';

import type { ProcessingLimits } from './processingLimits';

/**
 * Check a file's size against `maxFileBytes` (files only).
 *
 * @param filePath - The file.
 * @param maxFileBytes - The ceiling.
 * @returns The reason when over; `undefined` when within, or when `stat`
 *   fails (the resolver then reports the failure as before).
 */
export async function fileSizeExcess(
  filePath: string,
  maxFileBytes: number,
): Promise<string | undefined> {
  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch {
    return undefined;
  }
  return size > maxFileBytes
    ? `File is ${String(size)} bytes, over processing.maxFileBytes (${String(maxFileBytes)})`
    : undefined;
}

/**
 * Check extracted text against `maxTextBytes` (UTF-8 bytes).
 *
 * @param text - The extracted text.
 * @param limits - The ceilings.
 * @returns The reason when over, else `undefined`.
 */
export function textExcess(
  text: string,
  limits: Pick<ProcessingLimits, 'maxTextBytes'>,
): string | undefined {
  const bytes = Buffer.byteLength(text, 'utf8');
  return bytes > limits.maxTextBytes
    ? `Extracted text is ${String(bytes)} bytes, over processing.maxTextBytes (${String(limits.maxTextBytes)})`
    : undefined;
}

/**
 * Check a chunk count against `maxChunksPerFile`.
 *
 * @param chunks - How many chunks the text split into.
 * @param limits - The ceilings.
 * @returns The reason when over, else `undefined`.
 */
export function chunkExcess(
  chunks: number,
  limits: Pick<ProcessingLimits, 'maxChunksPerFile'>,
): string | undefined {
  return chunks > limits.maxChunksPerFile
    ? `Document splits into ${String(chunks)} chunks, over processing.maxChunksPerFile (${String(limits.maxChunksPerFile)})`
    : undefined;
}
