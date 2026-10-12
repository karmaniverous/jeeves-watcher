/**
 * @module test/harness/qdrant
 * Real-Qdrant helpers for integration tests: availability flag (set by globalSetup), URL, unique throwaway collection names, raw drop and payload-schema reads.
 */

/** Qdrant URL used by integration tests (`QDRANT_URL`, default localhost). */
export const QDRANT_URL = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

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
 * Generate a collection name unique to this worker and call.
 *
 * @param label - Short suite label (letters, digits, underscore).
 * @returns A name starting with {@link TEST_COLLECTION_PREFIX}.
 */
export function uniqueCollectionName(label: string): string {
  const worker = String(process.env['VITEST_WORKER_ID'] ?? process.pid);
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${TEST_COLLECTION_PREFIX}${label}_${worker}_${nonce}`;
}

function headers(): Record<string, string> {
  const apiKey = process.env['QDRANT_API_KEY'];
  return apiKey ? { 'api-key': apiKey } : {};
}

function assertTestCollection(name: string): void {
  if (!name.startsWith(TEST_COLLECTION_PREFIX)) {
    throw new Error(`Refusing to touch non-test collection "${name}"`);
  }
}

/**
 * Delete a harness collection (ignores a missing collection).
 *
 * @param name - Collection name; must carry {@link TEST_COLLECTION_PREFIX}.
 */
export async function dropCollection(name: string): Promise<void> {
  assertTestCollection(name);
  await fetch(`${QDRANT_URL}/collections/${name}`, {
    method: 'DELETE',
    headers: headers(),
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
  const res = await fetch(`${QDRANT_URL}/collections/${name}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`GET collection ${name} failed: ${String(res.status)}`);
  }
  const body = (await res.json()) as {
    result: { payload_schema: Record<string, PayloadSchemaEntry> };
  };
  return body.result.payload_schema;
}
