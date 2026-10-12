/**
 * @module processor/resolvers/SourceResolver
 * Source resolver: retrieves `<name>://<id>` through the SourceRetriever, evaluates the designated rule's match, applies only that rule, merges enrichment. Network I/O via the retriever.
 */

import type { ErrorObject } from 'ajv';

import { mergeEnrichment } from '../../enrichment';
import { extractJsonText } from '../../extractors';
import { applyRules, buildSourceAttributes } from '../../rules';
import {
  parseSourceReference,
  type SourceRetrievalResult,
  type SourceRetriever,
} from '../../sources';
import { ProcessingFailure } from '../issueRecording';
import { FIELD_CREATED_AT } from '../payloadFields';
import { syncExtractText } from '../syncExtractText';
import type {
  DocumentResolver,
  ResolvedDocument,
  ResolveOutcome,
  RuleContext,
} from './types';

/** What to resolve: a reference and its designated rule. */
export interface SourceTarget {
  /** The exact `<name>://<id>` reference. */
  ref: string;
  /** Designated rule name. */
  rule: string;
}

/** Context for {@link SourceResolver}. */
export interface SourceResolverContext extends RuleContext {
  /** Source callback client; absent when no sources are configured. */
  retriever?: SourceRetriever;
  /** Clock (injectable for tests). */
  now?: () => Date;
}

/**
 * Format AJV errors for an issue message.
 *
 * @param errors - AJV errors.
 * @returns One line, e.g. `/json must have required property 'userId'`.
 */
function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`)
    .join('; ');
}

/** Resolves a source reference through its callback and designated rule. */
export class SourceResolver implements DocumentResolver<SourceTarget> {
  /**
   * @param ctx - Rule context plus the retriever and clock.
   */
  constructor(private readonly ctx: SourceResolverContext) {}

  /**
   * Resolve a source document.
   *
   * @param target - Reference and designated rule.
   * @returns The document, or `gone` when the callback answered 404.
   * @throws ProcessingFailure `rule_missing` (rule not in the merged rule
   *   set; nothing retrieved), `source_unavailable` /
   *   `unsupported_content_type` (callback error), `no_content` (empty body)
   *   or `match_failed` (designated rule's `match` rejects the attributes;
   *   `details` holds the AJV errors).
   */
  async resolve({ ref, rule }: SourceTarget): Promise<ResolveOutcome> {
    const { ctx } = this;
    const compiled = ctx.compiledRules.find((c) => c.rule.name === rule);
    if (!compiled) {
      throw new ProcessingFailure(
        'rule_missing',
        `Designated rule "${rule}" does not exist`,
      );
    }

    const retrieved = await this.retrieve(ref);
    if (retrieved.kind === 'gone') return { kind: 'gone' };
    if (retrieved.kind === 'error') {
      throw new ProcessingFailure(retrieved.code, retrieved.message);
    }
    const { body } = retrieved;
    if (Object.keys(body).length === 0) {
      throw new ProcessingFailure('no_content', `Source document is empty`);
    }

    const now = (ctx.now ?? (() => new Date()))();
    const { name, id } = parseSourceReference(ref);
    const attributes = buildSourceAttributes({
      ref,
      name,
      id,
      rule,
      body,
      retrievedAt: now,
    });
    if (!compiled.validate(attributes)) {
      const errors = [...(compiled.validate.errors ?? [])];
      throw new ProcessingFailure(
        'match_failed',
        `Document does not match rule "${rule}": ${formatAjvErrors(errors)}`,
        errors,
      );
    }

    const applied = await applyRules([compiled], attributes, {
      namedMaps: ctx.config.maps,
      logger: ctx.logger,
      templateEngine: ctx.templateEngine,
      configDir: ctx.config.configDir,
      customMapLib: ctx.config.customMapLib,
      globalSchemas: ctx.config.globalSchemas,
      extractText: syncExtractText,
    });
    const enrichment = ctx.enrichmentStore?.get(ref) ?? null;
    const metadata = enrichment
      ? mergeEnrichment(applied.metadata, enrichment)
      : { ...applied.metadata };

    const rendered = applied.renderedContent;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const document: ResolvedDocument = {
      identity: { kind: 'source', ref, rule },
      text: rendered ?? extractJsonText(body),
      splitterExt: rendered !== null ? '.md' : '.json',
      metadata,
      metadataWithRules: { ...metadata, matched_rules: applied.matchedRules },
      matchedRules: applied.matchedRules,
      refreshMetadataWhenUnchanged: true,
      dates: (existing) => {
        const created = existing?.[FIELD_CREATED_AT];
        return Promise.resolve({
          createdAt: typeof created === 'number' ? created : nowSeconds,
          modifiedAt: nowSeconds,
        });
      },
    };
    return { kind: 'document', document };
  }

  /** Retrieve through the callback; reference errors become `source_unavailable`. */
  private async retrieve(ref: string): Promise<SourceRetrievalResult> {
    const { retriever } = this.ctx;
    if (!retriever) {
      throw new ProcessingFailure(
        'source_unavailable',
        'No sources are configured',
      );
    }
    try {
      return await retriever.retrieve(ref);
    } catch (error) {
      throw new ProcessingFailure('source_unavailable', error);
    }
  }
}
