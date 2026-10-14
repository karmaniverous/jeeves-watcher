/**
 * @module test/qdrant/http
 * Raw Qdrant REST helpers shared by the test harness and global setup: the optional API-key header and the `/collections` name listing. Network I/O.
 */

/**
 * Request headers for the Qdrant REST API.
 *
 * @param env - Environment (default `process.env`).
 * @returns `{ 'api-key' }` when `QDRANT_API_KEY` is set, else `{}`.
 */
export function qdrantHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const apiKey = env['QDRANT_API_KEY'];
  return apiKey ? { 'api-key': apiKey } : {};
}

/** Options of {@link fetchCollectionNames}. */
export interface FetchCollectionNamesOptions {
  /** Environment for the API key (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Request timeout in milliseconds (default: none). */
  timeoutMs?: number;
  /** Prefix of the error message, e.g. `[globalSetup] `. */
  errorPrefix?: string;
}

/**
 * List every collection name on a Qdrant server.
 *
 * @param url - Qdrant base URL.
 * @param options - Environment, timeout and error prefix.
 * @returns The collection names.
 * @throws When `/collections` answers non-2xx (or the request fails).
 */
export async function fetchCollectionNames(
  url: string,
  options: FetchCollectionNamesOptions = {},
): Promise<string[]> {
  const { env, timeoutMs, errorPrefix = '' } = options;
  const res = await fetch(`${url}/collections`, {
    headers: qdrantHeaders(env),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) {
    throw new Error(
      `${errorPrefix}GET ${url}/collections failed: ${String(res.status)}`,
    );
  }
  const body = (await res.json()) as {
    result: { collections: { name: string }[] };
  };
  return body.result.collections.map((c) => c.name);
}
