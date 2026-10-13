/**
 * @module processor/processSource
 * Processes one source document end to end (resolve → index or delete) and returns a per-document result; failures become issues keyed by the reference.
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';

import type { EnrichmentStoreInterface } from '../enrichment';
import type { DocumentIdentity } from './documentIdentity';
import {
  deleteDocumentPoints,
  indexDocument,
  type IndexOptions,
  type PipelineContext,
} from './documentPipeline';
import { reportFailure, withIssueType } from './issueRecording';
import type { SourceResolver } from './resolvers/SourceResolver';

/** Dependencies of {@link processSourceDocument}. */
export interface SourceProcessingDeps {
  /** Shared pipeline dependencies. */
  pipeline: PipelineContext;
  /** Resolver bound to the current rules and the source client. */
  resolver: SourceResolver;
  /** Enrichment store (entry removed when the document is gone). */
  enrichmentStore?: EnrichmentStoreInterface;
}

/** Issue code for failures no stage tagged (as for files). */
const UNTAGGED_ISSUE = 'extraction_error';

/**
 * Retrieve a source document through its callback and index it with its
 * designated rule. 404 deletes the document's points; other failures record
 * an issue (with the designated `rule` and any structured `details`) under
 * the exact reference and leave points untouched.
 *
 * @param deps - Pipeline, resolver and enrichment store.
 * @param ref - The exact `<name>://<id>` reference.
 * @param rule - The designated rule name.
 * @param options - Indexing options (`force` re-embeds unchanged content).
 * @returns The per-document result (`indexed` / `unchanged` / `deleted` / `failed`).
 */
export async function processSourceDocument(
  deps: SourceProcessingDeps,
  ref: string,
  rule: string,
  options: IndexOptions = {},
): Promise<DocumentResult> {
  const { pipeline } = deps;
  try {
    const outcome = await deps.resolver.resolve({ ref, rule });
    if (outcome.kind === 'gone') {
      const identity: DocumentIdentity = { kind: 'source', ref, rule };
      await withIssueType('upsert_error', () =>
        deleteDocumentPoints(pipeline.vectorStore, identity),
      );
      deps.enrichmentStore?.delete(ref);
      pipeline.issuesManager?.clear(ref);
      pipeline.logger.info({ source: ref }, 'Source document gone; deleted');
      return { source: ref, status: 'deleted' };
    }

    const matched_rules = outcome.document.matchedRules;
    const result = await indexDocument(pipeline, outcome.document, options);
    return result.status === 'indexed'
      ? { source: ref, status: 'indexed', chunks: result.chunks, matched_rules }
      : { source: ref, status: 'unchanged', matched_rules };
  } catch (error) {
    const failure = reportFailure(
      pipeline,
      {
        filePath: ref,
        operation: 'Failed to process source document',
        issueType: UNTAGGED_ISSUE,
        rule,
      },
      error,
    );
    const { type = UNTAGGED_ISSUE, message, details } = failure;
    return {
      source: ref,
      status: 'failed',
      error: { code: type, message, ...(details ? { details } : {}) },
    };
  }
}
