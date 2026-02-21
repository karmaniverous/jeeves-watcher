/**
 * @module buildMetadata
 *
 * Shared logic for building merged metadata from inference rules and enrichment files.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';

import { type ExtractedText, extractText } from '../extractors';
import { readMetadata } from '../metadata';
import type { CompiledRule } from '../rules';
import { applyRules, buildAttributes } from '../rules';

/**
 * The result of building merged metadata for a file.
 */
export interface MergedMetadata {
  /** Metadata inferred from rules. */
  inferred: Record<string, unknown>;
  /** Metadata loaded from enrichment file. */
  enrichment: Record<string, unknown> | null;
  /** Combined metadata (enrichment wins conflicts). */
  metadata: Record<string, unknown>;
  /** File attributes used for rule matching. */
  attributes: ReturnType<typeof buildAttributes>;
  /** Extracted text and structured data. */
  extracted: ExtractedText;
}

/**
 * Build merged metadata for a file by applying inference rules and merging with enrichment metadata.
 *
 * @param filePath - The file to process.
 * @param compiledRules - The compiled inference rules.
 * @param metadataDir - The metadata directory for enrichment files.
 * @param maps - Optional named JsonMap definitions.
 * @param logger - Optional logger for rule warnings.
 * @returns The merged metadata and intermediate data.
 */
export async function buildMergedMetadata(
  filePath: string,
  compiledRules: CompiledRule[],
  metadataDir: string,
  maps?: Record<string, JsonMapMap>,
  logger?: { warn: (msg: string) => void },
): Promise<MergedMetadata> {
  const ext = extname(filePath);
  const stats = await stat(filePath);

  // 1. Extract text and structured data
  const extracted = await extractText(filePath, ext);

  // 2. Build attributes + apply rules
  const attributes = buildAttributes(
    filePath,
    stats,
    extracted.frontmatter,
    extracted.json,
  );
  const inferred = await applyRules(compiledRules, attributes, maps, logger);

  // 3. Read enrichment metadata (merge, enrichment wins)
  const enrichment = await readMetadata(filePath, metadataDir);
  const metadata: Record<string, unknown> = {
    ...inferred,
    ...(enrichment ?? {}),
  };

  return { inferred, enrichment, metadata, attributes, extracted };
}
