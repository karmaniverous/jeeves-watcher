/**
 * @module processor/indexFile
 * Index one file: the maxFileBytes stat check before extraction (too_large deletes its points, D44), then resolve and run the shared pipeline; rule interpolation failures become issues. Filesystem and Qdrant I/O.
 */

import { fileSizeExcess } from './ceilings';
import {
  indexDocument,
  type PipelineContext,
  rejectTooLarge,
} from './documentPipeline';
import { recordRuleErrors } from './issueRecording';
import { DEFAULT_PROCESSING_LIMITS } from './processingLimits';
import type { FileResolver } from './resolvers/FileResolver';

/**
 * Index a file (caller holds its document lock and handles failures).
 *
 * @param ctx - Pipeline, resolver and stores.
 * @param filePath - The file.
 * @throws ProcessingFailure (e.g. `too_large`) or an untagged error.
 */
export async function indexFile(
  ctx: PipelineContext & { resolver: Pick<FileResolver, 'resolve'> },
  filePath: string,
): Promise<void> {
  const { maxFileBytes } = ctx.limits ?? DEFAULT_PROCESSING_LIMITS;
  const over = await fileSizeExcess(filePath, maxFileBytes);
  if (over) {
    await rejectTooLarge(ctx.vectorStore, { kind: 'file', filePath }, over);
  }
  const outcome = await ctx.resolver.resolve(filePath);
  if (outcome.kind === 'document') {
    const { document } = outcome;
    await indexDocument(ctx, document);
    // Indexed as before; the interpolation failure becomes an issue.
    recordRuleErrors(ctx.issuesManager, filePath, document.ruleErrors);
  }
}
