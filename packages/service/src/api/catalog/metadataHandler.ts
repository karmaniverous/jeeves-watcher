/**
 * @module api/catalog/metadataHandler
 * Catalog handler for `POST /metadata`: enrichment metadata updates via the document processor, for a file path or a source reference. The request is validated by the catalog's `setMetadata` entry schema; the metadata itself is validated here against the target's rule schemas.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import {
  documentTarget,
  type MetadataResponse,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { WatcherProcessor } from '../../processor';
import { API_LOCK_WAIT_MS } from '../../processor/DocumentLocks';
import {
  validateMetadataPayload,
  validateSourceMetadataPayload,
} from '../handlers/metadataValidation';
import { invalidRequest, RequestError } from '../requestError';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `setMetadata` entry's handler. */
export interface CatalogMetadataDeps {
  /** Document processor. */
  processor: WatcherProcessor;
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Logger. */
  logger: pino.Logger;
  /** Config directory (schema file references). */
  configDir?: string;
  /** Longest document-lock wait (default 10 s, D118; tests only). */
  lockWaitMs?: number;
}

/** The `404 source_not_indexed` error. */
const notIndexed = () =>
  new RequestError('source_not_indexed', 'Source document not indexed');

/** The `400 invalid_request` error for failed metadata validation. */
const invalid = (validation: { error: string; details?: unknown }) =>
  invalidRequest(validation.error, { details: validation.details });

/**
 * Enrich a source document. The designated rule comes from the stored
 * chunk-0 point (`404` when not indexed; nothing is stored then) and the
 * metadata is validated against that rule's schema, resolved by the
 * processor's own lookup (config or virtual rule).
 *
 * @param deps - Handler dependencies.
 * @param ref - The exact `<name>://<id>` reference.
 * @param metadata - Enrichment metadata.
 * @returns The response body.
 * @throws RequestError `404 source_not_indexed` or `400 invalid_request`.
 */
async function updateSourceMetadata(
  deps: CatalogMetadataDeps,
  ref: string,
  metadata: Record<string, unknown>,
): Promise<MetadataResponse> {
  const ops = deps.processor.sourceOperations();
  const rule = await ops.storedRule(ref);
  if (rule === null) throw notIndexed();
  const validation = validateSourceMetadataPayload(
    deps.getConfig(),
    ops.compiledRule(rule),
    metadata,
    deps.configDir,
  );
  if (!validation.ok) throw invalid(validation);
  const lockWaitMs = deps.lockWaitMs ?? API_LOCK_WAIT_MS;
  if ((await ops.updateMetadata(ref, metadata, { lockWaitMs })) === null) {
    throw notIndexed();
  }
  return { ok: true, matched_rules: validation.matchedRules };
}

/**
 * Create the catalog handler for `POST /metadata` (`path` or `source`).
 * Values that do not match the declared property types are
 * `400 invalid_request` with per-property `details`. A document whose lock
 * is not free within 10 s answers `503 not_available` with
 * `Retry-After: 10`, and nothing is changed (D118).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogMetadataHandler(
  deps: CatalogMetadataDeps,
): CatalogHandler<Entry<'setMetadata'>> {
  return wrapCatalogHandler<Entry<'setMetadata'>>(
    async (input) => {
      const { metadata } = input.body;
      const target = documentTarget(input.body);
      if (target.kind === 'source') {
        return {
          body: await updateSourceMetadata(deps, target.source, metadata),
        };
      }
      const { path } = target;

      const validation = validateMetadataPayload(
        deps.getConfig(),
        path,
        metadata,
        deps.configDir,
      );
      if (!validation.ok) throw invalid(validation);

      await deps.processor.processMetadataUpdate(path, metadata, {
        lockWaitMs: deps.lockWaitMs ?? API_LOCK_WAIT_MS,
      });
      return { body: { ok: true, matched_rules: validation.matchedRules } };
    },
    deps.logger,
    'Metadata update',
  );
}
