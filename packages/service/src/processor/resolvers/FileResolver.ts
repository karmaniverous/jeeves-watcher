/**
 * @module processor/resolvers/FileResolver
 * File resolver: today's stat/extract/buildAttributes/applyRules path behind the resolver interface. I/O: reads and stats the file, hashes it for move detection.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { ContentHashCache } from '../../cache';
import { fileHash } from '../../hash';
import type { ValuesManager } from '../../values';
import { buildMergedMetadata } from '../buildMetadata';
import { syncExtractText } from '../syncExtractText';
import { updateValues } from '../valuesIndex';
import { applyRuleOptions, metadataWithRules } from './ruleOptions';
import type {
  DocumentResolver,
  ResolvedDocument,
  ResolveOutcome,
  RuleContext,
} from './types';

/** Context for {@link FileResolver}. */
export interface FileResolverContext extends RuleContext {
  /** Content hash cache for move correlation. */
  contentHashCache?: ContentHashCache;
  /** Values index, fed with the rule metadata on every resolve. */
  valuesManager?: Pick<ValuesManager, 'update'>;
}

/** Resolves a file path into a document (behaviour identical to pre-0.20). */
export class FileResolver implements DocumentResolver<string> {
  /**
   * @param ctx - Rule context plus the content hash cache.
   */
  constructor(private readonly ctx: FileResolverContext) {}

  /**
   * Extract the file, apply all matching rules and merge enrichment.
   *
   * @param filePath - The file.
   * @returns Merged metadata, extraction and render results, plus
   *   `metadataWithRules` (metadata + `matched_rules`).
   */
  async buildMetadata(filePath: string) {
    const { ctx } = this;
    const result = await buildMergedMetadata({
      filePath,
      compiledRules: ctx.compiledRules,
      enrichmentStore: ctx.enrichmentStore,
      ruleOptions: applyRuleOptions(ctx, { extractText: syncExtractText }),
    });
    return {
      ...result,
      metadataWithRules: metadataWithRules(
        result.metadata,
        result.matchedRules,
      ),
    };
  }

  /**
   * Resolve a file. Files are never reported gone here (deletion arrives as
   * a watcher event).
   *
   * @param filePath - The file.
   * @returns The resolved document.
   */
  async resolve(filePath: string): Promise<ResolveOutcome> {
    const built = await this.buildMetadata(filePath);
    const document: ResolvedDocument = {
      identity: { kind: 'file', filePath },
      text: built.renderedContent ?? built.extracted.text,
      splitterExt: extname(filePath),
      metadata: built.metadata,
      metadataWithRules: built.metadataWithRules,
      matchedRules: built.matchedRules,
      ruleErrors: built.ruleErrors,
      onUnchanged: 'skip',
      logLabel: 'File',
      // Values must reflect current rule matches even when content is unchanged.
      onResolved: () => {
        updateValues(
          this.ctx.valuesManager,
          built.matchedRules,
          built.metadata,
        );
      },
      prepare: async () => {
        // File-level hash for the move correlation cache.
        const rawHash = await fileHash(filePath);
        this.ctx.contentHashCache?.set(filePath, rawHash);
      },
      dates: async () => {
        const stats = await stat(filePath);
        return {
          createdAt: Math.floor(stats.birthtimeMs / 1000),
          modifiedAt: Math.floor(stats.mtimeMs / 1000),
        };
      },
    };
    return { kind: 'document', document };
  }
}
