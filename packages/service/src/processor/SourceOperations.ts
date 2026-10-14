/**
 * @module processor/SourceOperations
 * Source-document operations for the API: notify validation (reference, configured source, rule), stored designated rule lookup, uncached render, metadata enrichment and processing. Qdrant and callback I/O.
 */

import type {
  DocumentFailure,
  DocumentRejectionError,
  DocumentResult,
} from '@karmaniverous/jeeves-watcher-core';

import type { EnrichmentStoreInterface } from '../enrichment';
import type { CompiledRule } from '../rules/compile';
import {
  parseSourceReference,
  SourceReferenceError,
  type SourceRetriever,
} from '../sources';
import { documentPointId, storedIdentity } from './documentIdentity';
import { updateDocumentMetadata } from './documentMetadata';
import type { IndexOptions, PipelineContext } from './documentPipeline';
import { ProcessingFailure } from './issueRecording';
import { processSourceDocument } from './processSource';
import { type RenderResult, toRenderResult } from './renderResult';
import { SourceResolver } from './resolvers/SourceResolver';
import type { RuleContext } from './resolvers/types';

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
  | { kind: 'failed'; error: DocumentFailure };

/** Source-document operations used by the API. */
export interface SourceOperationsInterface {
  /** Process a reference with its designated rule (see `processSourceDocument`); `force` re-embeds unchanged content. */
  process(
    ref: string,
    rule: string,
    options?: IndexOptions,
  ): Promise<DocumentResult>;
  /** Synchronously validate a notification; `undefined` when acceptable. */
  validate(ref: string, rule: string): DocumentRejectionError | undefined;
  /** Designated rule stored on the document's chunk-0 point, or `null` if not indexed. */
  storedRule(ref: string): Promise<string | null>;
  /**
   * The compiled rule a designated rule name resolves to in the merged rule
   * set (config rules, then virtual rules: first of that name), or
   * `undefined` when no such rule exists.
   */
  compiledRule(name: string): CompiledRule | undefined;
  /** Retrieve and render a document without embedding or writing anything. */
  render(ref: string, rule: string): Promise<SourceRenderOutcome>;
  /** Merge enrichment metadata into an indexed document's points; `null` if not indexed. */
  updateMetadata(
    ref: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

/** A processor exposing source operations (`DocumentProcessor` implements it). */
export interface SourceOperationsProvider {
  /** Source operations bound to the processor's current rules and stores. */
  sourceOperations(): SourceOperationsInterface;
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
  process(
    ref: string,
    rule: string,
    options?: IndexOptions,
  ): Promise<DocumentResult> {
    const { ctx } = this;
    return processSourceDocument(
      {
        pipeline: ctx.pipeline,
        resolver: this.resolver(),
        enrichmentStore: ctx.enrichmentStore,
      },
      ref,
      rule,
      options,
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
  validate(ref: string, rule: string): DocumentRejectionError | undefined {
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
    if (this.compiledRule(rule) === undefined) {
      return {
        code: 'rule_missing',
        message: `Rule "${rule}" does not exist`,
      };
    }
    return undefined;
  }

  /** {@inheritDoc SourceOperationsInterface.compiledRule} */
  compiledRule(name: string): CompiledRule | undefined {
    return this.ctx.rules.compiledRules.find((c) => c.rule.name === name);
  }

  /** {@inheritDoc SourceOperationsInterface.storedRule} */
  async storedRule(ref: string): Promise<string | null> {
    const target = { kind: 'source', ref } as const;
    const payload = await this.ctx.pipeline.vectorStore.getPayload(
      documentPointId(target, 0),
    );
    const identity = payload ? storedIdentity(target, payload) : null;
    return identity?.kind === 'source' ? identity.rule : null;
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
      return { kind: 'rendered', result: toRenderResult(outcome.document) };
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
   * Merge enrichment metadata into an indexed document's points (see
   * `updateDocumentMetadata`). Nothing is stored for a document that is not
   * indexed. System fields (`source`, `source_rule`, ...) are re-asserted,
   * so metadata can never overwrite them.
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param metadata - Enrichment metadata.
   * @returns The merged enrichment, or `null` when not indexed.
   */
  updateMetadata(
    ref: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const { pipeline, enrichmentStore } = this.ctx;
    return updateDocumentMetadata(
      { ...pipeline, enrichmentStore },
      { kind: 'source', ref },
      metadata,
    );
  }

  private resolver(): SourceResolver {
    return new SourceResolver({
      ...this.ctx.rules,
      retriever: this.ctx.retriever,
    });
  }
}
