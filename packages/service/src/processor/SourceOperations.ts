/**
 * @module processor/SourceOperations
 * Source-document operations for the API: notify validation (reference, configured source, rule), stored designated rule lookup, uncached render, metadata enrichment and processing. Qdrant and callback I/O.
 */

import type {
  DocumentError,
  DocumentResult,
} from '@karmaniverous/jeeves-watcher-core';

import type { EnrichmentStoreInterface } from '../enrichment';
import { sourcePointId } from '../pointId';
import {
  parseSourceReference,
  SourceReferenceError,
  type SourceRetriever,
} from '../sources';
import { getChunkCount } from './chunkIds';
import { documentChunkIds, type DocumentIdentity } from './documentIdentity';
import type { PipelineContext } from './documentPipeline';
import { ProcessingFailure } from './issueRecording';
import { FIELD_SOURCE_RULE } from './payloadFields';
import { processSourceDocument } from './processSource';
import type { RenderResult } from './renderResult';
import { SourceResolver } from './resolvers/SourceResolver';
import type { RuleContext } from './resolvers/types';
import { withSystemFields } from './systemFields';

/** Context of {@link SourceOperations}: a snapshot of the processor's state. */
export interface SourceOperationsContext {
  /** Current rule context (merged compiled rules, templates, enrichment). */
  rules: RuleContext;
  /** Shared pipeline dependencies. */
  pipeline: PipelineContext;
  /** Source callback client; absent when no sources are configured. */
  retriever?: SourceRetriever;
  /** Enrichment store, keyed by the exact reference. */
  enrichmentStore?: EnrichmentStoreInterface;
}

/** Outcome of rendering a source document (`POST /render { source }`). */
export type SourceRenderOutcome =
  | { kind: 'rendered'; result: RenderResult }
  | { kind: 'gone' }
  | { kind: 'failed'; error: DocumentError };

/** Source-document operations used by the API. */
export interface SourceOperationsInterface {
  /** Process a reference with its designated rule (see `processSource`). */
  process(ref: string, rule: string): Promise<DocumentResult>;
  /** Synchronously validate a notification; `undefined` when acceptable. */
  validate(ref: string, rule: string): DocumentError | undefined;
  /** Designated rule stored on the document's chunk-0 point, or `null` if not indexed. */
  storedRule(ref: string): Promise<string | null>;
  /** Retrieve and render a document without embedding or writing anything. */
  render(ref: string, rule: string): Promise<SourceRenderOutcome>;
  /** Merge enrichment metadata into an indexed document's points; `null` if not indexed. */
  updateMetadata(
    ref: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

/** A processor exposing source operations (see {@link hasSourceOperations}). */
export interface SourceOperationsProvider {
  /** Source operations bound to the processor's current rules and stores. */
  sourceOperations(): SourceOperationsInterface;
}

/**
 * Whether a processor (possibly a test double) exposes source operations.
 *
 * @param processor - The processor.
 * @returns `true` when it implements {@link SourceOperationsProvider}.
 */
export function hasSourceOperations(
  processor: object,
): processor is SourceOperationsProvider {
  return (
    typeof (processor as Partial<SourceOperationsProvider>).sourceOperations ===
    'function'
  );
}

/**
 * Source-document operations over a snapshot of the processor's state. Build
 * one per request (`DocumentProcessor.sourceOperations()`), so rule changes
 * apply to the next request.
 */
export class SourceOperations implements SourceOperationsInterface {
  /**
   * @param ctx - Rules, pipeline, retriever and enrichment store.
   */
  constructor(private readonly ctx: SourceOperationsContext) {}

  /** {@inheritDoc SourceOperationsInterface.process} */
  process(ref: string, rule: string): Promise<DocumentResult> {
    const { ctx } = this;
    return processSourceDocument(
      {
        pipeline: ctx.pipeline,
        resolver: this.resolver(),
        enrichmentStore: ctx.enrichmentStore,
      },
      ref,
      rule,
    );
  }

  /**
   * Synchronously validate a notification. Checks, in order: the reference parses (`invalid_reference`), its source
   * is configured and the id is safe (`unknown_source`, `invalid_id`; no
   * request is made), and the rule exists in the merged compiled rule set
   * (`rule_missing`).
   *
   * @param ref - Reference as submitted.
   * @param rule - Designated rule name.
   * @returns The rejection, or `undefined` when acceptable.
   */
  validate(ref: string, rule: string): DocumentError | undefined {
    try {
      parseSourceReference(ref);
      if (!this.ctx.retriever) {
        throw new SourceReferenceError(
          'unknown_source',
          'No sources are configured',
        );
      }
      this.ctx.retriever.resolve(ref);
    } catch (error) {
      if (error instanceof SourceReferenceError) {
        return { code: error.code, message: error.message };
      }
      throw error;
    }
    if (!this.ctx.rules.compiledRules.some((c) => c.rule.name === rule)) {
      return {
        code: 'rule_missing',
        message: `Rule "${rule}" does not exist`,
      };
    }
    return undefined;
  }

  /** {@inheritDoc SourceOperationsInterface.storedRule} */
  async storedRule(ref: string): Promise<string | null> {
    const payload = await this.chunkZero(ref);
    const rule = payload?.[FIELD_SOURCE_RULE];
    return typeof rule === 'string' && rule.length > 0 ? rule : null;
  }

  /**
   * Retrieve and render a document without embedding or writing anything.
   * Pipeline failures (`rule_missing`, `match_failed`, `source_unavailable`,
   * ...) are returned, not thrown, and never recorded as issues.
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param rule - Designated rule name.
   * @returns Rendered result, `gone` (callback 404) or `failed`.
   */
  async render(ref: string, rule: string): Promise<SourceRenderOutcome> {
    try {
      const outcome = await this.resolver().resolve({ ref, rule });
      if (outcome.kind === 'gone') return { kind: 'gone' };
      const { document } = outcome;
      const transformed = document.splitterExt === '.md';
      return {
        kind: 'rendered',
        result: {
          renderAs: transformed ? 'md' : 'json',
          content: document.text,
          rules: document.matchedRules,
          metadata: document.metadataWithRules,
          transformed,
        },
      };
    } catch (error) {
      if (!(error instanceof ProcessingFailure)) throw error;
      const { issueType: code, message, details } = error;
      return {
        kind: 'failed',
        error: { code, message, ...(details ? { details } : {}) },
      };
    }
  }

  /**
   * Merge enrichment metadata into an indexed document's points. Nothing is
   * stored for a document that is not indexed. System fields
   * (`source`, `source_rule`, ...) are re-asserted, so metadata can never
   * overwrite them.
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param metadata - Enrichment metadata.
   * @returns The merged enrichment, or `null` when not indexed.
   */
  async updateMetadata(
    ref: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const { pipeline, enrichmentStore } = this.ctx;
    const payload = await this.chunkZero(ref);
    const rule = payload?.[FIELD_SOURCE_RULE];
    if (!payload || typeof rule !== 'string') return null;

    enrichmentStore?.set(ref, metadata);
    const merged = enrichmentStore?.get(ref) ?? metadata;
    const identity: DocumentIdentity = { kind: 'source', ref, rule };
    const ids = documentChunkIds(identity, getChunkCount(payload));
    await pipeline.vectorStore.setPayload(
      ids,
      withSystemFields(merged, identity),
    );
    pipeline.logger.info(
      { source: ref, chunks: ids.length },
      'Source metadata updated',
    );
    return merged;
  }

  private chunkZero(ref: string): Promise<Record<string, unknown> | null> {
    return this.ctx.pipeline.vectorStore.getPayload(sourcePointId(ref, 0));
  }

  private resolver(): SourceResolver {
    return new SourceResolver({
      ...this.ctx.rules,
      retriever: this.ctx.retriever,
    });
  }
}
