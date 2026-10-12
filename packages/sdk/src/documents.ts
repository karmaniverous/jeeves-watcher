/**
 * @module documents
 * The `documents` method group: notify changed source documents (POST /documents, 202 or ?wait=true) and delete them (POST /documents/delete). Network I/O via the transport.
 */

import {
  type DocumentNotification,
  type DocumentsAcceptedResponse,
  documentsAcceptedResponseSchema,
  type DocumentsDeleteRequest,
  documentsDeleteRequestSchema,
  type DocumentsDeleteResponse,
  documentsDeleteResponseSchema,
  documentsRequestSchema,
  type DocumentsResultsResponse,
  documentsResultsResponseSchema,
} from '@karmaniverous/jeeves-watcher-core';

import type { Transport } from './transport.js';

/** Options for {@link DocumentsApi.notify}. */
export interface NotifyOptions {
  /**
   * Process synchronously (`?wait=true`) and resolve with per-document
   * results instead of the `202` accepted/rejected lists. For backfill and
   * tests; the normal path is asynchronous.
   */
  wait?: boolean;
}

/** Source-document operations. Notify only: the watcher always retrieves content through the source callback. */
export interface DocumentsApi {
  /**
   * Notify the watcher that source documents changed (`POST /documents`).
   * The watcher queues and coalesces the references and retrieves each
   * through its source callback. Resolves with the `202` body: accepted
   * references and synchronously rejected notifications.
   *
   * @param documents - 1 to 100 `{ source, rule }` notifications.
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
   * @param documents - 1 to 100 `{ source, rule }` notifications.
   * @param options - `{ wait: true }`.
   */
  notify(
    documents: DocumentNotification[],
    options: NotifyOptions & { wait: true },
  ): Promise<DocumentsResultsResponse>;
  /**
   * Notify with a `wait` flag known only at runtime.
   *
   * @param documents - 1 to 100 `{ source, rule }` notifications.
   * @param options - Notify options.
   */
  notify(
    documents: DocumentNotification[],
    options?: NotifyOptions,
  ): Promise<DocumentsAcceptedResponse | DocumentsResultsResponse>;
  /**
   * Delete source documents (`POST /documents/delete`) by reference or by
   * Qdrant filter. The server constrains the filter to points carrying
   * `source`, so file points are never deleted.
   *
   * @param request - `{ sources }` or `{ filter }`.
   * @returns The number of documents (not points) removed.
   */
  delete(request: DocumentsDeleteRequest): Promise<DocumentsDeleteResponse>;
}

/**
 * Build the `documents` method group.
 *
 * @param transport - Client transport.
 * @returns The {@link DocumentsApi}.
 */
export function createDocumentsApi(transport: Transport): DocumentsApi {
  function notify(
    documents: DocumentNotification[],
    options?: NotifyOptions,
  ): Promise<DocumentsAcceptedResponse | DocumentsResultsResponse> {
    const body = { documents };
    if (options?.wait === true) {
      return transport({
        endpoint: 'documents',
        body,
        bodySchema: documentsRequestSchema,
        query: { wait: 'true' },
        responseSchema: documentsResultsResponseSchema,
      });
    }
    return transport({
      endpoint: 'documents',
      body,
      bodySchema: documentsRequestSchema,
      responseSchema: documentsAcceptedResponseSchema,
    });
  }

  return {
    notify: notify as DocumentsApi['notify'],
    delete: (request) =>
      transport({
        endpoint: 'documentsDelete',
        body: request,
        bodySchema: documentsDeleteRequestSchema,
        responseSchema: documentsDeleteResponseSchema,
      }),
  };
}
