/**
 * @module processor/resolvers/types
 * Resolver contract: a resolver turns a target (file path or source reference) into a ResolvedDocument for the shared pipeline, or reports it gone. Types only.
 */

import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import type { CompiledRule, RuleApplicationError } from '../../rules';
import type { TemplateEngine } from '../../templates';
import type { DocumentIdentity } from '../documentIdentity';
import type { DocumentDates } from '../processingPipeline';
import type { ProcessorConfig } from '../ProcessorConfig';

/** Rule-application context shared by all resolvers (current at construction). */
export interface RuleContext {
  /** Merged compiled rule set (config + virtual rules). */
  compiledRules: CompiledRule[];
  /** Processor configuration (maps, configDir, custom map lib, schemas). */
  config: ProcessorConfig;
  /** Logger for rule warnings. */
  logger: pino.Logger;
  /** Template engine for rule `template`s. */
  templateEngine?: TemplateEngine;
  /** Enrichment store, keyed by file path or reference. */
  enrichmentStore?: EnrichmentStoreInterface;
}

/** A document ready for the shared pipeline. */
export interface ResolvedDocument {
  /** Identity (point IDs, identity fields, store keys). */
  identity: DocumentIdentity;
  /** Text to embed (rendered output or extracted text). */
  text: string;
  /** Extension selecting the splitter (`.md` → Markdown splitter). */
  splitterExt: string;
  /** Rule metadata merged with enrichment (values index input). */
  metadata: Record<string, unknown>;
  /** {@link ResolvedDocument.metadata} plus `matched_rules` (payload input). */
  metadataWithRules: Record<string, unknown>;
  /** Names of the rules applied. */
  matchedRules: string[];
  /**
   * Content type of {@link ResolvedDocument.text} for render responses (file
   * extension without dot): the rule's `renderAs`, else the file extension
   * (`txt` when none); `md` for a rendered source document, else `json`.
   */
  renderAs: string;
  /** Whether a template or render transform produced the text. */
  transformed: boolean;
  /**
   * Rule interpolation failures of a file (recorded as an
   * `interpolation_error` issue after indexing). Source resolvers fail the
   * document instead, so this is empty or absent for sources.
   */
  ruleErrors?: RuleApplicationError[];
  /**
   * What to do when the content hash is unchanged: `skip` (files), or
   * `refresh` differing projected metadata with set-payload /
   * delete-payload (sources).
   */
  onUnchanged: 'skip' | 'refresh';
  /** Log label naming the document kind (`File`, `Source document`). */
  logLabel: string;
  /**
   * Side effects run as soon as the document is resolved, before the empty
   * check and whether or not content changed (files feed the values index;
   * source documents never do).
   */
  onResolved?: () => void;
  /** Side effects run once the document is known to be non-empty. */
  prepare?: () => Promise<void>;
  /**
   * Point timestamps.
   *
   * @param existingPayload - Current chunk-0 payload, or null.
   */
  dates: (
    existingPayload: Record<string, unknown> | null,
  ) => Promise<DocumentDates>;
}

/** Result of resolving a target. */
export type ResolveOutcome =
  { kind: 'document'; document: ResolvedDocument } | { kind: 'gone' };

/**
 * Resolves a target into a document. Failures are thrown as
 * `ProcessingFailure` carrying the issue code.
 */
export interface DocumentResolver<TTarget> {
  /**
   * Resolve a target.
   *
   * @param target - What to resolve.
   */
  resolve(target: TTarget): Promise<ResolveOutcome>;
}
