/**
 * @module api/sourceDiscovery
 * Finds the source documents a reindex covers: scrolls Qdrant for chunk-0 source points (isSourcePoint; projection: source, source_rule, file_path), or resolves issue references to their stored or recorded rules. Qdrant reads only.
 */

import { parallel } from 'radash';

import type { IssueRecord } from '../issues/types';
import {
  FIELD_CHUNK_INDEX,
  FIELD_FILE_PATH,
  FIELD_SOURCE,
  FIELD_SOURCE_RULE,
  isSourcePoint,
  SOURCE_POINT_CONDITIONS,
} from '../processor/payloadFields';
import type { SourceTarget } from '../processor/resolvers/SourceResolver';
import type { SourceOperationsInterface } from '../processor/SourceOperations';
import { parseSourceReference } from '../sources';
import { isSourceReference } from '../util/documentKey';
import type { VectorStore } from '../vectorStore';

/** Scroll page size for source discovery. */
const DISCOVERY_PAGE_SIZE = 256;

/** Chunk-0 source points (see {@link isSourcePoint}): one per source document. */
const INDEXED_SOURCES_FILTER = {
  must: [
    { key: FIELD_CHUNK_INDEX, match: { value: 0 } },
    ...SOURCE_POINT_CONDITIONS.must,
  ],
  must_not: SOURCE_POINT_CONDITIONS.must_not,
};

/** Source documents found for a reindex. */
export interface SourceDiscovery {
  /** Documents examined (chunk-0 points, or source issue keys). */
  total: number;
  /** Documents with a known designated rule: the ones to process. */
  targets: SourceTarget[];
  /**
   * Issue references whose stored-rule lookup failed (scope `issues`): not
   * processed, counted and listed as failed by the run.
   */
  unresolved?: string[];
}

/**
 * Discover every indexed source document from its chunk-0 point. Documents
 * whose chunk 0 lacks a `source_rule` are counted in `total` but not
 * targeted (no rule to apply).
 *
 * @param vectorStore - The vector store.
 * @returns Every indexed source document and its stored designated rule.
 */
export async function discoverIndexedSources(
  vectorStore: Pick<VectorStore, 'scrollPage'>,
): Promise<SourceDiscovery> {
  const targets: SourceTarget[] = [];
  const seen = new Set<string>();
  let total = 0;
  let cursor: string | number | undefined;
  do {
    const page = await vectorStore.scrollPage(
      INDEXED_SOURCES_FILTER,
      DISCOVERY_PAGE_SIZE,
      cursor,
      [FIELD_SOURCE, FIELD_SOURCE_RULE, FIELD_FILE_PATH],
    );
    for (const { payload } of page.points) {
      if (!isSourcePoint(payload)) continue;
      const ref = String(payload[FIELD_SOURCE]);
      if (seen.has(ref)) continue;
      seen.add(ref);
      total++;
      const rule = payload[FIELD_SOURCE_RULE];
      if (typeof rule === 'string' && rule.length > 0) {
        targets.push({ ref, rule });
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return { total, targets };
}

/**
 * Designated rule recorded on a reference's issues (the latest one that
 * carries a rule), or `null`.
 *
 * @param issues - The reference's issue records.
 * @returns The recorded rule, or `null`.
 */
function recordedRule(
  issues: readonly IssueRecord[] | undefined,
): string | null {
  const withRule = (issues ?? []).filter(
    (issue) => typeof issue.rule === 'string' && issue.rule.length > 0,
  );
  return withRule.at(-1)?.rule ?? null;
}

/**
 * Look up the rule stored on each reference's chunk-0 point (Qdrant reads,
 * bounded concurrency) for `POST /reindex { scope: 'path', source }`. A
 * failed lookup rejects (the request fails); issue discovery tolerates
 * failures instead (see {@link discoverIssueSources}).
 *
 * @param ops - Source operations (stored rule lookup).
 * @param refs - Source references.
 * @param concurrency - Lookups in flight (at least 1).
 * @returns Each reference with its stored rule (`null` when not indexed),
 *   in input order.
 */
export async function resolveStoredRules(
  ops: Pick<SourceOperationsInterface, 'storedRule'>,
  refs: readonly string[],
  concurrency: number,
): Promise<Array<{ ref: string; rule: string | null }>> {
  return parallel(Math.max(1, concurrency), [...refs], async (ref) => ({
    ref,
    rule: await ops.storedRule(ref),
  }));
}

/**
 * Resolve the source references among the issues to their designated rules:
 * the rule stored on the document's chunk-0 point when it is indexed,
 * otherwise the rule recorded on its issue. A document whose first
 * notification failed therefore has no points but is still retried. A
 * reference with neither is counted in `total` only (it recovers through
 * its next notification).
 *
 * A failed lookup (a Qdrant read error, or a processor without source
 * support) never fails the run: the reference is reported in `unresolved`
 * and `onLookupError` is called with the error.
 *
 * @param issues - The issues store contents (file paths and references).
 * @param ops - Source operations (stored rule lookup).
 * @param concurrency - Stored-rule lookups in flight (`reindex.concurrency`).
 * @param onLookupError - Called for each failed lookup.
 * @returns The source issue documents and their rules.
 */
export async function discoverIssueSources(
  issues: Partial<Record<string, readonly IssueRecord[]>>,
  ops: Pick<SourceOperationsInterface, 'storedRule'>,
  concurrency: number,
  onLookupError?: (ref: string, error: unknown) => void,
): Promise<SourceDiscovery> {
  const refs = Object.keys(issues).filter(isSourceReference);
  const stored = await parallel(Math.max(1, concurrency), refs, async (ref) => {
    try {
      return { ref, ok: true as const, rule: await ops.storedRule(ref) };
    } catch (error) {
      onLookupError?.(ref, error);
      return { ref, ok: false as const };
    }
  });
  const targets: SourceTarget[] = [];
  const unresolved: string[] = [];
  for (const entry of stored) {
    if (!entry.ok) {
      unresolved.push(entry.ref);
      continue;
    }
    const resolved = entry.rule ?? recordedRule(issues[entry.ref]);
    if (resolved !== null) targets.push({ ref: entry.ref, rule: resolved });
  }
  return { total: refs.length, targets, unresolved };
}

/**
 * Count targets per source name (the plan's `byRoot` entries for sources,
 * as for `POST /reindex { scope: 'path', source }`).
 *
 * @param targets - Source documents.
 * @returns Count per source name.
 */
export function countBySourceName(
  targets: SourceTarget[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { ref } of targets) {
    const { name } = parseSourceReference(ref);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
