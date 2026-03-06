/**
 * @module processor/buildMetadata
 * Builds merged metadata from file content, inference rules, and enrichment. I/O: reads files, extracts text, loads enrichment .meta.json.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';
import type pino from 'pino';

import type { SchemaEntry } from '../config/schemas';
import { type ExtractedText, extractText } from '../extractors';
import { readMetadata } from '../metadata';
import type { CompiledRule } from '../rules';
import { applyRules, buildAttributes } from '../rules';
import type { TemplateEngine } from '../templates';

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
  /** Rendered template content, or null if no template matched. */
  renderedContent: string | null;
  /** Names of rules that matched. */
  matchedRules: string[];
  /** The renderAs value from the highest-priority matched rule, or null. */
  renderAs: string | null;
}

/**
 * Options for building merged metadata.
 */
export interface BuildMergedMetadataOptions {
  /** The file to process. */
  filePath: string;
  /** The compiled inference rules. */
  compiledRules: CompiledRule[];
  /** The metadata directory for enrichment files. */
  metadataDir: string;
  /** Optional named JsonMap definitions. */
  maps?: Record<string, JsonMapMap>;
  /** Optional logger for rule warnings. */
  logger?: pino.Logger;
  /** Optional template engine for content templates. */
  templateEngine?: TemplateEngine;
  /** Optional config directory for resolving file paths. */
  configDir?: string;
  /** Optional custom JsonMap transform library. */
  customMapLib?: Record<string, (...args: unknown[]) => unknown>;
  /** Optional global schemas collection. */
  globalSchemas?: Record<string, SchemaEntry>;
}

/**
 * Build merged metadata for a file by applying inference rules and merging with enrichment metadata.
 *
 * @param options - Build options.
 * @returns The merged metadata and intermediate data.
 */
export async function buildMergedMetadata(
  options: BuildMergedMetadataOptions,
): Promise<MergedMetadata> {
  const {
    filePath,
    compiledRules,
    metadataDir,
    maps,
    logger,
    templateEngine,
    configDir,
    customMapLib,
    globalSchemas,
  } = options;
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
  const {
    metadata: inferred,
    renderedContent,
    matchedRules,
    renderAs,
  } = await applyRules(compiledRules, attributes, {
    namedMaps: maps,
    logger,
    templateEngine,
    configDir,
    customMapLib,
    globalSchemas,
  });

  // 3. Read enrichment metadata (merge, enrichment wins)
  const enrichment = await readMetadata(filePath, metadataDir);
  const metadata: Record<string, unknown> = {
    ...inferred,
    ...(enrichment ?? {}),
  };

  return {
    inferred,
    enrichment,
    metadata,
    attributes,
    extracted,
    renderedContent,
    matchedRules,
    renderAs,
  };
}
