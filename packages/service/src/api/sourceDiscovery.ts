/**
 * @module api/sourceDiscovery
 * Finds the source documents a reindex covers: scrolls Qdrant for chunk-0 points carrying `source` (projection: source, source_rule), or resolves issue keys to stored rules. Qdrant reads only.
 */

import { parallel } from 'radash';

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
 * Resolve the source references among issue keys to their stored designated
 * rules. References that are not indexed have no known rule and are counted
 * in `total` only (they recover through the next notification).
 *
 * @param issueKeys - Keys of the issues store (file paths and references).
 * @param ops - Source operations (stored rule lookup).
 * @returns The source issue documents and their rules.
 */
export async function discoverIssueSources(
  issueKeys: string[],
  ops: Pick<SourceOperationsInterface, 'storedRule'>,
): Promise<SourceDiscovery> {
  const refs = issueKeys.filter(isSourceReference);
  const found = await parallel(RULE_LOOKUP_CONCURRENCY, refs, async (ref) => ({
    ref,
    rule: await ops.storedRule(ref),
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
