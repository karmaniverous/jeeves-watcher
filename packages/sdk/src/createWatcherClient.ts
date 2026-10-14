/**
 * @module createWatcherClient
 * Typed client factory for the application-facing watcher API: status, search, scan, render, metadata, reindex, issues and the documents group. Network I/O via fetch.
 */

import {
  type IssuesResponse,
  issuesResponseSchema,
  type MetadataRequest,
  metadataRequestSchema,
  type MetadataResponse,
  metadataResponseSchema,
  type ReindexRequest,
  reindexRequestSchema,
  type ReindexResponse,
  reindexResponseSchema,
  type RenderRequest,
  renderRequestSchema,
  type RenderResponse,
  renderResponseSchema,
  type ScanRequest,
  scanRequestSchema,
  type ScanResponse,
  scanResponseSchema,
  type SearchRequest,
  searchRequestSchema,
  type SearchResponse,
  searchResponseSchema,
  type StatusResponse,
  statusResponseSchema,
} from '@karmaniverous/jeeves-watcher-core';

import { createDocumentsApi, type DocumentsApi } from './documents.js';
import { resolveClientOptions, type WatcherClientOptions } from './options.js';
import { createTransport } from './transport.js';

/**
 * A watcher API client. Every method validates its request with the core
 * schema before sending, validates the response, and throws a
 * {@link WatcherError} on any failure. No retries.
 */
export interface WatcherClient {
  /** Service health (`GET /status`; open even when an API key is configured). */
  status(): Promise<StatusResponse>;
  /**
   * Semantic search (`POST /search`).
   *
   * @param request - Query text, optional `limit`, `offset` and Qdrant `filter`.
   */
  search(request: SearchRequest): Promise<SearchResponse>;
  /**
   * Filter-only point query (`POST /scan`).
   *
   * @param request - Qdrant `filter`, optional `limit`, `cursor`, `fields`, `countOnly`.
   */
  scan(request: ScanRequest): Promise<ScanResponse>;
  /**
   * Render a document through the template pipeline (`POST /render`).
   *
   * @param request - `{ path }` for a file or `{ source }` for a source document.
   */
  render(request: RenderRequest): Promise<RenderResponse>;
  /**
   * Set enrichment metadata on a document (`POST /metadata`).
   *
   * @param request - `{ path }` or `{ source }`, plus `metadata`.
   */
  metadata(request: MetadataRequest): Promise<MetadataResponse>;
  /**
   * Start a scoped reindex (`POST /reindex`).
   *
   * @param request - Scope (default `issues`), targets and `dryRun`.
   */
  reindex(request?: ReindexRequest): Promise<ReindexResponse>;
  /** Current processing issues keyed by document (`GET /issues`). */
  issues(): Promise<IssuesResponse>;
  /** Source-document notify and delete. */
  documents: DocumentsApi;
}

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
  const transport = createTransport(resolveClientOptions(options));
  return {
    status: () =>
      transport({ endpoint: 'status', responseSchema: statusResponseSchema }),
    search: (request) =>
      transport({
        endpoint: 'search',
        body: request,
        bodySchema: searchRequestSchema,
        responseSchema: searchResponseSchema,
      }),
    scan: (request) =>
      transport({
        endpoint: 'scan',
        body: request,
        bodySchema: scanRequestSchema,
        responseSchema: scanResponseSchema,
      }),
    render: (request) =>
      transport({
        endpoint: 'render',
        body: request,
        bodySchema: renderRequestSchema,
        responseSchema: renderResponseSchema,
      }),
    metadata: (request) =>
      transport({
        endpoint: 'metadata',
        body: request,
        bodySchema: metadataRequestSchema,
        responseSchema: metadataResponseSchema,
      }),
    reindex: (request = {}) =>
      transport({
        endpoint: 'reindex',
        body: request,
        bodySchema: reindexRequestSchema,
        responseSchema: reindexResponseSchema,
      }),
    issues: () =>
      transport({ endpoint: 'issues', responseSchema: issuesResponseSchema }),
    documents: createDocumentsApi(transport),
  };
}
