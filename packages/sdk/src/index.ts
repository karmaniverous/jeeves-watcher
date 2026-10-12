/**
 * Typed client for the jeeves-watcher HTTP API: `createWatcherClient`, the `documents` notify/delete group, Qdrant filter helpers `f`, `WatcherError`, and the core API and callback-contract types.
 *
 * @packageDocumentation
 */

export {
  createWatcherClient,
  type WatcherClient,
} from './createWatcherClient.js';
export { type DocumentsApi, type NotifyOptions } from './documents.js';
export { f, type MatchValue, type RangeBounds } from './filters.js';
export {
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  type WatcherClientOptions,
} from './options.js';
export {
  isWatcherError,
  type WatcherClientErrorCode,
  WatcherError,
  type WatcherErrorInit,
} from './WatcherError.js';

// Core API types (request/response shapes) and the source callback contract.
export {
  type ApiErrorResponse,
  type DocumentError,
  type DocumentNotification,
  type DocumentRejection,
  type DocumentRejectionCode,
  type DocumentResult,
  type DocumentResultStatus,
  type DocumentsAcceptedResponse,
  type DocumentsDeleteRequest,
  type DocumentsDeleteResponse,
  type DocumentsResultsResponse,
  ISSUE_TYPES,
  type IssueRecord,
  type IssuesResponse,
  type IssueType,
  MAX_DOCUMENTS_PER_REQUEST,
  type MetadataRequest,
  type MetadataResponse,
  type QdrantFilter,
  type ReindexPlan,
  type ReindexRequest,
  type ReindexResponse,
  type ReindexScope,
  type RenderRequest,
  type RenderResponse,
  type ScanRequest,
  type ScanResponse,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  SOURCE_DOCUMENT_GONE_STATUS,
  SOURCE_REFERENCE_PATTERN,
  type SourceDocument,
  type SourceReference,
  type StatusResponse,
} from '@karmaniverous/jeeves-watcher-core';
