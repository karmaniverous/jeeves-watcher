/**
 * @module api/catalog/rulesReapplyHandler
 * Catalog handler for `POST /rules/reapply`: the catalog validates the body (`globs`); the handler delegates to `reapplyRules`.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import { API_LOCK_WAIT_MS } from '../../processor/DocumentLocks';
import type { VectorStore } from '../../vectorStore';
import { reapplyRules } from '../reapplyRules';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `reapplyRules` entry's handler. */
export interface CatalogRulesReapplyDeps {
  /** Document processor (re-applies rules per file). */
  processor: DocumentProcessorInterface;
  /** Vector store scrolled for indexed file paths. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** Longest wait for each document lock (default 10 s, D118; tests only). */
  lockWaitMs?: number;
}

/**
 * Create the catalog handler for `POST /rules/reapply`: re-applies current
 * inference rules to indexed files matching `globs` without re-embedding.
 * A file whose lock is not free within 10 s ends the request with
 * `503 WATCHER_NOT_AVAILABLE` and `Retry-After: 10`; files already updated keep
 * their update (D118).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler (`{ matched, updated }`).
 */
export function createCatalogRulesReapplyHandler(
  deps: CatalogRulesReapplyDeps,
): CatalogHandler<Entry<'reapplyRules'>> {
  return wrapCatalogHandler<Entry<'reapplyRules'>>(
    async (input) => ({
      body: await reapplyRules(
        deps.vectorStore,
        deps.processor,
        input.body.globs,
        deps.logger,
        { lockWaitMs: deps.lockWaitMs ?? API_LOCK_WAIT_MS },
      ),
    }),
    deps.logger,
    'RulesReapply',
  );
}
