/**
 * @module documents
 * The `documents` method group over the catalog's `notifyDocuments` (POST /documents, 202 or ?wait=true) and `deleteDocuments` (POST /documents/delete) entries (D60). Network I/O via the client methods it wraps.
 */

import type { CatalogClient } from '@karmaniverous/jeeves/catalog';
import type {
  DocumentNotification,
  DocumentsAcceptedResponse,
  DocumentsDeleteRequest,
  DocumentsDeleteResponse,
  DocumentsResultsResponse,
  WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';

import { WatcherError } from './WatcherError.js';

/** Options for {@link DocumentsApi.notify}. */
export interface NotifyOptions {
  /**
   * Process synchronously (`?wait=true`) and resolve with per-document
   * results instead of the `202` accepted/rejected lists. For backfill and
   * tests; the normal path is asynchronous. Not bounded by the server: it
   * returns only when every document has been processed, which can take
   * minutes behind document locks and embedding rate-limit waits (D137).
   * Size the client's `timeoutMs` for the batch, or omit `wait`.
   */
  wait?: boolean;
}

/** Source-document operations. Notify only: the watcher always retrieves content through the source callback. */
export interface DocumentsApi {
  /**
   * Notify the watcher that source documents changed (`POST /documents`,
   * catalog entry `notifyDocuments`). The watcher queues and coalesces the
   * references and retrieves each through its source callback. Resolves with
   * the `202` body: accepted references and synchronously rejected
   * notifications.
   *
   * @param documents - 1 to {@link MAX_DOCUMENTS_PER_REQUEST} `{ source, rule }` notifications.
   * @param options - Omit, or `{ wait: false }`.
   */
  notify(
    documents: DocumentNotification[],
    options?: NotifyOptions & { wait?: false },
  ): Promise<DocumentsAcceptedResponse>;
  /**
   * Notify and process synchronously (`POST /documents?wait=true`). Resolves
   * with one result per document (`indexed`, `unchanged`, `deleted`, `failed`).
   *
   * @param documents - 1 to {@link MAX_DOCUMENTS_PER_REQUEST} `{ source, rule }` notifications.
   * @param options - `{ wait: true }`.
   */
  notify(
    documents: DocumentNotification[],
    options: NotifyOptions & { wait: true },
  ): Promise<DocumentsResultsResponse>;
  /**
   * Notify with a `wait` flag known only at runtime.
   *
   * @param documents - 1 to {@link MAX_DOCUMENTS_PER_REQUEST} `{ source, rule }` notifications.
   * @param options - Notify options.
   */
  notify(
    documents: DocumentNotification[],
    options?: NotifyOptions,
  ): Promise<DocumentsAcceptedResponse | DocumentsResultsResponse>;
  /**
   * Delete source documents (`POST /documents/delete`, catalog entry
   * `deleteDocuments`) by reference or by Qdrant filter. The server
   * constrains the filter to points carrying `source` and no `file_path`, so
   * file points are never deleted. A condition-free filter (`{}`,
   * `{ must: [] }`, `f.and()` with no operands, ...) would match every source
   * document and is refused client-side with `invalid_request` before any
   * request is sent.
   *
   * @param request - `{ sources }` or `{ filter }` (at least one condition).
   * @returns The number of documents (not points) removed.
   */
  delete(request: DocumentsDeleteRequest): Promise<DocumentsDeleteResponse>;
}

/** The catalog client's method for the `notifyDocuments` entry. */
export type NotifyDocuments = CatalogClient<WatcherCatalog>['notifyDocuments'];

/** The catalog client's method for the `deleteDocuments` entry. */
export type DeleteDocuments = CatalogClient<WatcherCatalog>['deleteDocuments'];

/**
 * Build the `documents` method group.
 *
 * @param notifyDocuments - Client method of the `notifyDocuments` entry.
 * @param deleteDocuments - Client method of the `deleteDocuments` entry.
 * @returns The {@link DocumentsApi}.
 */
export function createDocumentsApi(
  notifyDocuments: NotifyDocuments,
  deleteDocuments: DeleteDocuments,
): DocumentsApi {
  return {
    notify: (async (
      documents: DocumentNotification[],
      options?: NotifyOptions,
    ) => {
      const wait = options?.wait === true;
      const body = await notifyDocuments(
        wait ? { documents, wait: 'true' } : { documents },
      );
      if (wait !== 'results' in body) {
        throw new WatcherError({
          code: 'invalid_response',
          message: `notifyDocuments answered without ${wait ? 'per-document results' : 'accepted references'}`,
          details: body,
        });
      }
      return body;
    }) as DocumentsApi['notify'],
    delete: (request) => deleteDocuments(request),
  };
}
