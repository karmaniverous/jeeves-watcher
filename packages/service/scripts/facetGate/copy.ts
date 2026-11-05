/**
 * @module scripts/facetGate/copy
 * Build the gate's payload-only copy (D144, D160): scroll the source collection (read only, without `chunk_text` or vectors) into a collection of 1-dimension vectors on another Qdrant, then pad it to the point floor with resampled payloads under fresh ids. HTTP I/O.
 */

import { randomUUID } from 'node:crypto';

/** A Qdrant collection on a server. */
export interface CollectionRef {
  /** Server URL. */
  url: string;
  /** Collection name. */
  collection: string;
}

/** What the copy holds. */
export interface CopyResult {
  /** Points copied from the source. */
  copied: number;
  /** Points added by resampling. */
  padded: number;
  /** Points holding each payload key. */
  keyCounts: Map<string, number>;
}

const PAGE = 2_000;
const SAMPLE_MAX = 200_000;

/** POST/PUT/GET JSON to Qdrant; returns `result`. */
async function call<T>(
  url: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { result: T };
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${String(res.status)} ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return json.result;
}

/**
 * The source collection's point count (a GET).
 *
 * @param source - Source collection.
 * @returns Its point count.
 */
export async function sourcePointCount(source: CollectionRef): Promise<number> {
  const info = await call<{ points_count: number }>(
    source.url,
    'GET',
    `/collections/${source.collection}`,
  );
  return info.points_count;
}

/**
 * Copy the source's payloads into a fresh target collection and pad it.
 *
 * @param source - Source collection (only read: GET and scroll).
 * @param target - Target collection (created; must be on another server).
 * @param size - Points the copy must hold (at least the source's).
 * @param log - Progress logger.
 * @returns What was copied.
 */
export async function copyPayloads(
  source: CollectionRef,
  target: CollectionRef,
  size: number,
  log: (message: string) => void,
): Promise<CopyResult> {
  if (new URL(source.url).origin === new URL(target.url).origin) {
    throw new Error('The gate copy must go to another Qdrant than the source');
  }
  await call(target.url, 'PUT', `/collections/${target.collection}`, {
    vectors: { size: 1, distance: 'Dot' },
    optimizers_config: { indexing_threshold: 0 },
  });
  const put = (points: unknown[]) =>
    call(
      target.url,
      'PUT',
      `/collections/${target.collection}/points?wait=true`,
      {
        points,
      },
    );

  const keyCounts = new Map<string, number>();
  const sample: Array<Record<string, unknown>> = [];
  let offset: unknown = null;
  let copied = 0;
  do {
    const page = await call<{
      points: Array<{ id: string | number; payload: Record<string, unknown> }>;
      next_page_offset?: unknown;
    }>(source.url, 'POST', `/collections/${source.collection}/points/scroll`, {
      limit: PAGE,
      offset,
      with_payload: { exclude: ['chunk_text'] },
      with_vector: false,
    });
    for (const { payload } of page.points) {
      for (const key of Object.keys(payload)) {
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      }
      if (sample.length < SAMPLE_MAX && Math.random() < 0.3)
        sample.push(payload);
    }
    if (page.points.length > 0) {
      await put(
        page.points.map(({ id, payload }) => ({ id, vector: [1], payload })),
      );
    }
    copied += page.points.length;
    offset = page.next_page_offset ?? null;
    if (copied % 100_000 < PAGE) log(`copied ${String(copied)}`);
  } while (offset !== null);

  let padded = 0;
  while (copied + padded < size && sample.length > 0) {
    const n = Math.min(PAGE, size - copied - padded);
    await put(
      Array.from({ length: n }, () => ({
        id: randomUUID(),
        vector: [1],
        payload: sample[Math.floor(Math.random() * sample.length)],
      })),
    );
    padded += n;
  }
  log(`copied ${String(copied)}, padded ${String(padded)}`);
  return { copied, padded, keyCounts };
}
