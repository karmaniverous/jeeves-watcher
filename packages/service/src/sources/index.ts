/**
 * @module sources
 * Source callback client: resolves `<name>://<id>` references against configured sources and retrieves documents over HTTP (document / gone / error).
 */

export { SourceClient, type SourceRetriever } from './SourceClient';
export { parseSourceReference } from './sourceUrl';
export {
  type ParsedSourceReference,
  parsedSourceReferenceSchema,
  type ResolvedSourceReference,
  resolvedSourceReferenceSchema,
  type SourceErrorCode,
  sourceErrorCodeSchema,
  SourceReferenceError,
  type SourceRejectionCode,
  sourceRejectionCodeSchema,
  type SourceRetrievalResult,
  sourceRetrievalResultSchema,
} from './types';
