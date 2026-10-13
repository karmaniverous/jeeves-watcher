/**
 * @module api/sourceDiscovery
 * Finds the source documents a reindex covers: scrolls Qdrant for chunk-0 points carrying `source` (projection: source, source_rule), or resolves issue references to their stored or recorded rules. Qdrant reads only.
 */

import { parallel } from 'radash';

import type { IssueRecord } from '../issues/types';
import type { SourceTarget } from '../processor/resolvers/SourceResolver';
import type { SourceOperationsInterface } from '../processor/SourceOperations';
import { parseSourceReference } from '../sources';
import { isSourceReference } from '../util/documentKey';
import type { VectorStore } from '../vectorStore';

/** Scroll page size for source discovery. */
const DISCOVERY_PAGE_SIZE = 256;

/** Parallel stored-rule lookups for issue references. */
const RULE_LOOKUP_CONCURRENCY = 16;

/** Chunk-0 points that carry a non-empty `source`: one per source document. */
const INDEXED_SOURCES_FILTER = {
  must: [{ key: 'chunk_index', match: { value: 0 } }],
  must_not: [{ is_empty: { key: 'source' } }],
};

/** Source documents found for a reindex. */
export interface SourceDiscovery {
  /** Documents examined (chunk-0 points, or source issue keys). */
  total: number;
  /** Documents with a known designated rule: the ones to process. */
  targets: SourceTarget[];
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
      ['source', 'source_rule'],
    );
    for (const { payload } of page.points) {
      const ref = payload['source'];
      if (typeof ref !== 'string' || ref.length === 0 || seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      total++;
      const rule = payload['source_rule'];
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
 * Resolve the source references among the issues to their designated rules:
 * the rule stored on the document's chunk-0 point when it is indexed,
 * otherwise the rule recorded on its issue. A document whose first
 * notification failed therefore has no points but is still retried. A
 * reference with neither is counted in `total` only (it recovers through
 * its next notification).
 *
 * @param issues - The issues store contents (file paths and references).
 * @param ops - Source operations (stored rule lookup).
 * @returns The source issue documents and their rules.
 */
export async function discoverIssueSources(
  issues: Partial<Record<string, readonly IssueRecord[]>>,
  ops: Pick<SourceOperationsInterface, 'storedRule'>,
): Promise<SourceDiscovery> {
  const refs = Object.keys(issues).filter(isSourceReference);
  const found = await parallel(RULE_LOOKUP_CONCURRENCY, refs, async (ref) => ({
    ref,
    rule: (await ops.storedRule(ref)) ?? recordedRule(issues[ref]),
  }));
  const targets: SourceTarget[] = [];
  for (const { ref, rule } of found) {
    if (rule !== null) targets.push({ ref, rule });
  }
  return { total: refs.length, targets };
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
