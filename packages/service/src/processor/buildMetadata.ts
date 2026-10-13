/**
 * @module processor/buildMetadata
 * Builds merged metadata from file content, inference rules, and enrichment store. I/O: reads files, extracts text, queries SQLite enrichment.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { EnrichmentStoreInterface } from '../enrichment';
import { type ExtractedText, extractText } from '../extractors';
import type { CompiledRule, RuleApplicationError } from '../rules';
import { applyRules, buildAttributes } from '../rules';
import type { ApplyRulesOptions } from '../rules/apply';
import { withEnrichment } from './resolvers/ruleOptions';

/**
 * The result of building merged metadata for a file.
 */
interface MergedMetadata {
  /** Metadata inferred from rules. */
  inferred: Record<string, unknown>;
  /** Combined metadata (composable merge). */
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
  /** Interpolation failures of matched rules (recorded as an issue). */
  ruleErrors: RuleApplicationError[];
}

/**
 * Options for building merged metadata.
 */
interface BuildMergedMetadataOptions {
  /** The file to process. */
  filePath: string;
  /** The compiled inference rules. */
  compiledRules: CompiledRule[];
  /** Options passed to `applyRules` (see `applyRuleOptions`). */
  ruleOptions?: ApplyRulesOptions;
  /** Optional enrichment store for persisted metadata. */
  enrichmentStore?: EnrichmentStoreInterface;
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
  const { filePath, compiledRules, ruleOptions, enrichmentStore } = options;
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
    errors: ruleErrors,
  } = await applyRules(compiledRules, attributes, ruleOptions);

  // 3. Merge enrichment metadata from the store (composable merge)
  const metadata = withEnrichment(enrichmentStore, filePath, inferred);

  return {
    inferred,
    metadata,
    attributes,
    extracted,
    renderedContent,
    matchedRules,
    renderAs,
    ruleErrors,
  };
}
