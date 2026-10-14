/**
 * @module test/harness/qdrant
 * Real-Qdrant helpers for integration tests: availability flag (set by globalSetup), URL, unique run-scoped throwaway collection names, prefix and URL guards, raw drop/sweep and payload-schema reads.
 * Every create/delete goes through {@link assertTestCollection} (only `jeeves_watcher_it_*` collections) and {@link assertTestQdrantUrl} (only the run's own, guarded Qdrant).
 */

import { fetchCollectionNames, qdrantHeaders } from '../qdrant/http';

/** Env var: this test run's id, set by globalSetup and inherited by workers. */
export const RUN_ID_ENV = 'JEEVES_WATCHER_IT_RUN';

/**
 * Env var: the Qdrant URL globalSetup provisioned or checked with the
 * shared-instance guard. Tests may only touch this instance.
 */
export const GUARDED_URL_ENV = 'JEEVES_WATCHER_IT_QDRANT_URL';

/**
 * Fallback when no Qdrant was provisioned: a refused loopback port, so a
 * stray call fails fast and never reaches a real (possibly production) Qdrant.
 */
const UNPROVISIONED_QDRANT_URL = 'http://127.0.0.1:9';

/**
 * Current harness Qdrant URL. Read lazily: global setup exports the
 * throwaway instance's URL as `QDRANT_URL` after this module loads.
 *
 * @returns `QDRANT_URL`, or a refused loopback URL when unset.
 */
export function qdrantUrl(): string {
  return process.env['QDRANT_URL'] ?? UNPROVISIONED_QDRANT_URL;
}

/** Prefix of every collection created by the harness; nothing else is touched. */
export const TEST_COLLECTION_PREFIX = 'jeeves_watcher_it_';

/**
 * Whether a real Qdrant answered the global-setup probe. Integration suites
 * use `describe.skipIf(!qdrantAvailable())`, matching the existing suites.
 *
 * @returns `true` when `QDRANT_AVAILABLE` is `'true'`.
 */
export function qdrantAvailable(): boolean {
  return process.env['QDRANT_AVAILABLE'] === 'true';
}

/**
 * A fresh run id (`r` + 8 lower-case base-36 characters).
 *
 * @returns The id.
 */
export function newRunId(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `r${random}`;
}

/**
 * This run's id (from {@link RUN_ID_ENV}; `rlocal` outside a vitest run).
 *
 * @returns The run id.
 */
export function currentRunId(): string {
  return process.env[RUN_ID_ENV] ?? 'rlocal';
}

/**
 * Generate a collection name unique to this run, worker and call:
 * `jeeves_watcher_it_<label>_<run>_<worker>_<nonce>`.
 *
 * @param label - Short suite label (letters, digits, underscore).
 * @returns A name starting with {@link TEST_COLLECTION_PREFIX}.
 */
export function uniqueCollectionName(label: string): string {
  const worker = String(process.env['VITEST_WORKER_ID'] ?? process.pid);
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${TEST_COLLECTION_PREFIX}${label}_${currentRunId()}_${worker}_${nonce}`;
}

/**
 * Whether a collection was named by {@link uniqueCollectionName} in run
 * `runId`. Pure.
 *
 * @param name - Collection name.
 * @param runId - Run id.
 * @returns `true` for this run's harness collections only.
 */
export function isRunCollection(name: string, runId: string): boolean {
  return (
    name.startsWith(TEST_COLLECTION_PREFIX) &&
    new RegExp(`_${runId}_[^_]+_[a-z0-9]+$`).test(name)
  );
}

/**
 * Guard: throw unless `url` is the Qdrant this run provisioned or guarded
 * (globalSetup exports it as {@link GUARDED_URL_ENV}).
 *
 * @param url - Qdrant URL a test is about to use.
 * @param env - Environment (default `process.env`).
 * @throws When no guarded Qdrant exists or `url` is another instance.
 */
export function assertTestQdrantUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const guarded = env[GUARDED_URL_ENV];
  if (!guarded || url !== guarded) {
    throw new Error(
      `Refusing to use the Qdrant at ${url}: tests may only touch this run's guarded Qdrant (${guarded ?? 'none'})`,
    );
  }
}

/**
 * Guard a vector-store target: harness collection name and guarded URL.
 *
 * @param target - `vectorStore` config (url and collection name).
 * @throws When either guard fails.
 */
export function assertTestVectorStore(target: {
  url: string;
  collectionName: string;
}): void {
  assertTestCollection(target.collectionName);
  assertTestQdrantUrl(target.url);
}

/**
 * Guard: throw unless `name` is a harness collection. Call before creating
 * or deleting any collection from a test.
 *
 * @param name - Collection name.
 * @throws When `name` does not start with {@link TEST_COLLECTION_PREFIX}.
 */
export function assertTestCollection(name: string): void {
  if (!name.startsWith(TEST_COLLECTION_PREFIX)) {
    throw new Error(`Refusing to touch non-test collection "${name}"`);
  }
}

/**
 * List the harness collections currently on the Qdrant server.
 *
 * @returns Names starting with {@link TEST_COLLECTION_PREFIX}.
 */
export async function listTestCollections(): Promise<string[]> {
  return (await fetchCollectionNames(qdrantUrl())).filter((name) =>
    name.startsWith(TEST_COLLECTION_PREFIX),
  );
}

/**
 * Drop this run's leftover harness collections (end-of-run sweep). Never
 * touches another run's collections (a concurrent run on a shared Qdrant)
 * or any collection without {@link TEST_COLLECTION_PREFIX}.
 *
 * @param runId - Run whose collections to drop (default: this run).
 * @returns The names dropped.
 */
export async function dropLeftoverTestCollections(
  runId: string = currentRunId(),
): Promise<string[]> {
  const names = (await listTestCollections()).filter((name) =>
    isRunCollection(name, runId),
  );
  for (const name of names) await dropCollection(name);
  return names;
}

/**
 * Delete a harness collection (ignores a missing collection) on this run's
 * guarded Qdrant.
 *
 * @param name - Collection name; must carry {@link TEST_COLLECTION_PREFIX}.
 */
export async function dropCollection(name: string): Promise<void> {
  assertTestCollection(name);
  assertTestQdrantUrl(qdrantUrl());
  await fetch(`${qdrantUrl()}/collections/${name}`, {
    method: 'DELETE',
    headers: qdrantHeaders(),
  });
}

/** One entry of Qdrant's `payload_schema`. */
export interface PayloadSchemaEntry {
  /** Index type, e.g. `keyword`. */
  data_type: string;
  /** Index parameters, e.g. `{ type: 'keyword', is_tenant: true }`. */
  params?: Record<string, unknown>;
}

/**
 * Read a collection's payload index schema straight from Qdrant's REST API
 * (bypassing the client under test).
 *
 * @param name - Collection name.
 * @returns Field name to index info.
 */
export async function getPayloadSchema(
  name: string,
): Promise<Record<string, PayloadSchemaEntry>> {
  const res = await fetch(`${qdrantUrl()}/collections/${name}`, {
    headers: qdrantHeaders(),
  });
  if (!res.ok) {
    throw new Error(`GET collection ${name} failed: ${String(res.status)}`);
  }
  const body = (await res.json()) as {
    result: { payload_schema: Record<string, PayloadSchemaEntry> };
  };
  return body.result.payload_schema;
}
