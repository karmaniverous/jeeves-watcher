/**
 * @module processor/indexFile
 * Index one file: the maxFileBytes stat check before extraction (too_large deletes its points, D44), then resolve (an extraction failure deletes the points of an indexed file, D201) and run the shared pipeline; rule interpolation failures become issues. Filesystem and Qdrant I/O.
 */

import { logError } from '../util/logError';
import { fileSizeExcess } from './ceilings';
import { type DocumentIdentity, documentPointId } from './documentIdentity';
import {
  deleteDocumentPoints,
  indexDocument,
  type PipelineContext,
  rejectTooLarge,
} from './documentPipeline';
import { recordRuleErrors } from './issueRecording';
import { DEFAULT_PROCESSING_LIMITS } from './processingLimits';
import type { FileResolver } from './resolvers/FileResolver';
import type { ResolveOutcome } from './resolvers/types';

/** Context of {@link indexFile}: the pipeline plus a file resolver. */
type IndexFileContext = PipelineContext & {
  resolver: Pick<FileResolver, 'resolve'>;
};

/**
 * Resolve a file (extract, apply rules). When that fails, an indexed file's
 * points are deleted before the failure is rethrown: search results from
 * content that can no longer be read are worse than none (D201). Only the
 * points go, as with `too_large`; the enrichment is kept for when the file
 * reads again. A failing delete is logged, and the extraction failure is
 * still the one rethrown (it becomes the file's issue).
 *
 * @param ctx - Pipeline and resolver.
 * @param filePath - The file.
 * @returns The resolve outcome.
 * @throws The resolver's error, after the points are deleted.
 */
async function resolveFile(
  ctx: IndexFileContext,
  filePath: string,
): Promise<ResolveOutcome> {
  try {
    return await ctx.resolver.resolve(filePath);
  } catch (error) {
    const identity: DocumentIdentity = { kind: 'file', filePath };
    try {
      const indexed = await ctx.vectorStore.getPayload(
        documentPointId(identity, 0),
      );
      if (indexed) {
        const chunks = await deleteDocumentPoints(ctx.vectorStore, identity);
        ctx.logger.warn(
          { filePath, chunks },
          'Extraction failed: file removed from the index until it reads again',
        );
      }
    } catch (deleteError) {
      logError(
        ctx.logger,
        deleteError,
        { filePath },
        'Extraction failed, and deleting the file from the index failed too',
      );
    }
    throw error;
  }
}

/**
 * Index a file (caller holds its document lock and handles failures).
 *
 * @param ctx - Pipeline, resolver and stores.
 * @param filePath - The file.
 * @throws ProcessingFailure (e.g. `too_large`) or an untagged error (an
 * extraction failure, after the file's points are deleted).
 */
export async function indexFile(
  ctx: IndexFileContext,
  filePath: string,
): Promise<void> {
  const { maxFileBytes } = ctx.limits ?? DEFAULT_PROCESSING_LIMITS;
  const over = await fileSizeExcess(filePath, maxFileBytes);
  if (over) {
    await rejectTooLarge(ctx.vectorStore, { kind: 'file', filePath }, over);
  }
  const outcome = await resolveFile(ctx, filePath);
  if (outcome.kind === 'document') {
    const { document } = outcome;
    await indexDocument(ctx, document);
    // Indexed as before; the interpolation failure becomes an issue.
    recordRuleErrors(ctx.issuesManager, filePath, document.ruleErrors);
  }
}
