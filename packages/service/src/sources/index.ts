/**
 * @module sources
 * Source callback client: resolves `<name>://<id>` references against configured sources and retrieves documents over HTTP (document / gone / error).
 */

export { SourceClient, type SourceRetriever } from './SourceClient';
export { parseSourceReference } from './sourceUrl';
export {
  type ParsedSourceReference,
  type ResolvedSourceReference,
  type SourceErrorCode,
  SourceReferenceError,
  type SourceRejectionCode,
  type SourceRetrievalResult,
  sourceRetrievalResultSchema,
} from './types';
