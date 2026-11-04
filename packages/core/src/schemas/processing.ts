/**
 * @module schemas/processing
 * `processing` config: the per-document ceilings (file size before extraction, extracted text bytes, chunk count) past which a document is `too_large` (D44, D64).
 */

import { z } from 'zod';

import { PROCESSING_DEFAULTS } from '../defaults.js';
import { byteSizeSchema } from './byteSize.js';

/** Processing ceilings, read per document (a reload applies to the next one). */
export const processingConfigSchema = z.object({
  /** File size cap, checked with `stat` before extraction (files only). */
  maxFileBytes: byteSizeSchema
    .optional()
    .describe(
      `Largest file processed, checked with stat before extraction (files only; source documents keep the 10 MiB response cap): bytes, or a string with a k, m or g suffix (binary units). A larger file has its points deleted and a too_large issue recorded. Default: '${PROCESSING_DEFAULTS.maxFileBytes}'.`,
    ),
  /** Most chunks one document may split into. */
  maxChunksPerFile: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Most chunks one document (file or source) may split into; more has its points deleted and a too_large issue recorded. Default: ${String(PROCESSING_DEFAULTS.maxChunksPerFile)}.`,
    ),
  /** Extracted text cap (UTF-8 bytes). */
  maxTextBytes: byteSizeSchema
    .optional()
    .describe(
      `Largest extracted text of one document (file or source), in UTF-8 bytes: bytes, or a string with a k, m or g suffix (binary units). More has its points deleted and a too_large issue recorded. Default: '${PROCESSING_DEFAULTS.maxTextBytes}'.`,
    ),
});

/** Processing ceilings as configured. */
export type ProcessingConfig = z.infer<typeof processingConfigSchema>;
