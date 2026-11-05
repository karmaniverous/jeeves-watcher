/**
 * @module catalog/writeEntries
 * The watcher catalog's `write` entries, in catalog order (spec Design 3 kinds). No I/O.
 */

import { z } from 'zod';

import {
  documentsAcceptedResponseSchema,
  documentsEnvelopeSchema,
  documentsQuerySchema,
  documentsResultsResponseSchema,
  metadataRequestSchema,
  metadataResponseSchema,
  rebuildMetadataRequestSchema,
  rebuildMetadataResponseSchema,
  reindexRequestSchema,
  reindexResponseSchema,
  rulesReapplyRequestSchema,
  rulesReapplyResponseSchema,
  rulesRegisterRequestSchema,
  rulesRegisterResponseSchema,
} from '../api/index.js';
import { route } from './routes.js';

/** The `write` entries. */
export const WRITE_ENTRIES = [
  {
    ...route(
      'setMetadata',
      'POST',
      '/metadata',
      'Set or update metadata on a document by file path or source reference. While the document is being processed the route waits at most 10 s for its lock, then answers 503 `not_available` with `Retry-After: 10`, nothing changed (retry).',
    ),
    body: metadataRequestSchema,
    response: metadataResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'reindex',
      'POST',
      '/reindex',
      'Trigger a scoped reindex of watched files (scope path also accepts source references).',
    ),
    body: reindexRequestSchema,
    response: reindexResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'notifyDocuments',
      'POST',
      '/documents',
      'Notify changed source documents ({ source, rule }); queued and coalesced (202), or processed synchronously with ?wait=true. Answers 202 with accepted and rejected references, or with `wait=true` 200 with per-document results.',
    ),
    query: documentsQuerySchema,
    body: documentsEnvelopeSchema,
    response: z.union([
      documentsAcceptedResponseSchema,
      documentsResultsResponseSchema,
    ]),
    kind: 'write',
  },
  {
    ...route(
      'registerRules',
      'POST',
      '/rules/register',
      'Register external inference rules.',
    ),
    body: rulesRegisterRequestSchema,
    response: rulesRegisterResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'reapplyRules',
      'POST',
      '/rules/reapply',
      'Re-apply inference rules to existing vector points. The route waits at most 10 s for each document lock; if one stays busy it answers 503 `not_available` with `Retry-After: 10`, and documents already updated keep their update (retry to finish).',
    ),
    body: rulesReapplyRequestSchema,
    response: rulesReapplyResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'rebuildMetadata',
      'POST',
      '/rebuild-metadata',
      'Rebuild the enrichment store from vector point payloads (file points only).',
    ),
    body: rebuildMetadataRequestSchema,
    response: rebuildMetadataResponseSchema,
    kind: 'write',
  },
] as const;
