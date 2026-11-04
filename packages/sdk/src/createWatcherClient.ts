/**
 * @module createWatcherClient
 * Typed watcher API client built on jeeves's catalog client: one method per `WATCHER_CATALOG` entry, named by the entry, plus the `documents` group; every failure is a {@link WatcherError}. Network I/O via fetch.
 */

import {
  type CatalogClient,
  createCatalogClient,
} from '@karmaniverous/jeeves/catalog';
import {
  WATCHER_CATALOG,
  type WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';

import { createDocumentsApi, type DocumentsApi } from './documents.js';
import { resolveClientOptions, type WatcherClientOptions } from './options.js';
import { toWatcherError } from './toWatcherError.js';

/**
 * A watcher API client: one method per `WATCHER_CATALOG` entry, named by the
 * entry (`search`, `listIssues`, `showVcsFile`, ...), except
 * `notifyDocuments` and `deleteDocuments`, which are the `documents` group.
 * Every method validates its input against the entry's schemas before
 * sending, parses the response with the entry's response schema (unknown
 * keys are dropped), and throws a {@link WatcherError} on any failure. No
 * retries.
 */
export type WatcherClient = Omit<
  CatalogClient<WatcherCatalog>,
  'notifyDocuments' | 'deleteDocuments'
> & {
  /** Source-document notify and delete. */
  documents: DocumentsApi;
};

/**
 * Create a watcher API client.
 *
 * @example
 * ```ts
 * const watcher = createWatcherClient({
 *   baseUrl: 'http://watcher.internal.example:1936',
 *   apiKey: process.env.WATCHER_API_KEY,
 * });
 * await watcher.documents.notify([{ source: 'app://chat/thread/123', rule: 'chat-thread' }]);
 * ```
 *
 * @param options - Base URL, optional API key, timeout (default 10000 ms) and `fetch`.
 * @returns A {@link WatcherClient}.
 * @throws {@link WatcherError} `invalid_options` when the options are invalid.
 */
export function createWatcherClient(
  options: WatcherClientOptions,
): WatcherClient {
  const resolved = resolveClientOptions(options);
  const catalogClient = createCatalogClient(WATCHER_CATALOG, {
    baseUrl: resolved.baseUrl,
    ...(resolved.apiKey === undefined
      ? {}
      : { auth: { bearer: resolved.apiKey } }),
    timeoutMs: resolved.timeoutMs,
    fetch: resolved.fetch,
  });
  const methods = Object.fromEntries(
    WATCHER_CATALOG.entries.map(({ name }) => {
      const call = catalogClient[name] as (input?: unknown) => Promise<unknown>;
      const method = (input?: unknown) =>
        call(input).catch((error: unknown) => {
          throw toWatcherError(error, name, resolved.timeoutMs);
        });
      return [name, method];
    }),
  ) as unknown as CatalogClient<WatcherCatalog>;
  const { notifyDocuments, deleteDocuments, ...rest } = methods;
  return {
    ...rest,
    documents: createDocumentsApi(notifyDocuments, deleteDocuments),
  };
}
