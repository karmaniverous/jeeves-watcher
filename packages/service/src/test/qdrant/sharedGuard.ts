/**
 * @module test/qdrant/sharedGuard
 * Production guard for an explicit `QDRANT_URL`: refuse to run tests against a Qdrant that already holds collections not prefixed `jeeves_watcher_it_`, unless `QDRANT_ALLOW_SHARED=true`.
 * {@link findForeignCollections} and {@link sharedInstanceError} are pure; {@link assertNotSharedQdrant} reads `/collections` over HTTP.
 */

import { TEST_COLLECTION_PREFIX } from '../harness/qdrant';

/**
 * Collections that the test harness did not create.
 *
 * @param names - Collection names on the server.
 * @returns Names without {@link TEST_COLLECTION_PREFIX}.
 */
export function findForeignCollections(names: string[]): string[] {
  return names.filter((name) => !name.startsWith(TEST_COLLECTION_PREFIX));
}

/**
 * Decide whether a Qdrant with these collections may be used.
 *
 * @param url - The Qdrant URL (for the message).
 * @param names - Collection names on the server.
 * @param allowShared - Value of `QDRANT_ALLOW_SHARED`.
 * @returns An error to throw, or `undefined` when the instance may be used.
 */
export function sharedInstanceError(
  url: string,
  names: string[],
  allowShared: string | undefined,
): Error | undefined {
  const foreign = findForeignCollections(names);
  if (!foreign.length || allowShared === 'true') return undefined;
  return new Error(
    [
      `[globalSetup] Refusing to run tests against the Qdrant at ${url}:`,
      `it already holds collections the test suite did not create (${foreign.join(', ')}).`,
      'This looks like a shared or production instance. Unset QDRANT_URL to let the',
      'suite start a throwaway Qdrant, point QDRANT_URL at an empty instance, or set',
      `QDRANT_ALLOW_SHARED=true to proceed anyway (tests only touch ${TEST_COLLECTION_PREFIX}* collections).`,
    ].join('\n'),
  );
}

/**
 * Throw unless the Qdrant at `url` is empty of foreign collections (or
 * `QDRANT_ALLOW_SHARED=true`). Sends `QDRANT_API_KEY` when set.
 *
 * @param url - Reachable Qdrant base URL.
 * @param env - Environment (default `process.env`).
 * @throws When the instance looks shared, or `/collections` cannot be read.
 */
export async function assertNotSharedQdrant(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const apiKey = env['QDRANT_API_KEY'];
  const res = await fetch(`${url}/collections`, {
    headers: apiKey ? { 'api-key': apiKey } : {},
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(
      `[globalSetup] GET ${url}/collections failed: ${String(res.status)}`,
    );
  }
  const body = (await res.json()) as {
    result: { collections: { name: string }[] };
  };
  const names = body.result.collections.map((c) => c.name);
  const error = sharedInstanceError(url, names, env['QDRANT_ALLOW_SHARED']);
  if (error) throw error;
}
