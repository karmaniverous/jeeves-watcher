/**
 * @module processor/processingLimits
 * Resolve the `processing` ceilings (D44, D64) from the live config to bytes and a chunk count; read per document, so a reload applies to the next one. Pure.
 */

import {
  parseByteSize,
  PROCESSING_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';

/** The resolved ceilings. */
export interface ProcessingLimits {
  /** Largest file processed (bytes, checked with `stat` before extraction). */
  maxFileBytes: number;
  /** Most chunks one document may split into. */
  maxChunksPerFile: number;
  /** Largest extracted text (UTF-8 bytes). */
  maxTextBytes: number;
}

/**
 * The ceilings under `config`, defaults filled in.
 *
 * @param config - The current config (`processing` may be absent).
 * @returns The ceilings.
 */
export function resolveProcessingLimits(
  config: Pick<JeevesWatcherConfig, 'processing'>,
): ProcessingLimits {
  const processing = config.processing ?? {};
  return {
    maxFileBytes: parseByteSize(
      processing.maxFileBytes ?? PROCESSING_DEFAULTS.maxFileBytes,
    ),
    maxChunksPerFile:
      processing.maxChunksPerFile ?? PROCESSING_DEFAULTS.maxChunksPerFile,
    maxTextBytes: parseByteSize(
      processing.maxTextBytes ?? PROCESSING_DEFAULTS.maxTextBytes,
    ),
  };
}

/** The ceilings with every default (a processor without a config getter). */
export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits =
  resolveProcessingLimits({});
