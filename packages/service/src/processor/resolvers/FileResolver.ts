/**
 * @module processor/resolvers/FileResolver
 * File resolver: today's stat/extract/buildAttributes/applyRules path behind the resolver interface. I/O: reads and stats the file, hashes it for move detection.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { ContentHashCache } from '../../cache';
import { fileHash } from '../../hash';
import { buildMergedMetadata } from '../buildMetadata';
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
      maps: ctx.config.maps,
      logger: ctx.logger,
      templateEngine: ctx.templateEngine,
      configDir: ctx.config.configDir,
      customMapLib: ctx.config.customMapLib,
      globalSchemas: ctx.config.globalSchemas,
    });
    const metadataWithRules = {
      ...result.metadata,
      matched_rules: result.matchedRules,
    };
    return { ...result, metadataWithRules, renderAs: result.renderAs };
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
      refreshMetadataWhenUnchanged: false,
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
