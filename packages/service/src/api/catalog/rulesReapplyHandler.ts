/**
 * @module api/catalog/rulesReapplyHandler
 * Catalog handler for `POST /rules/reapply`: the catalog validates the body (`globs`); the handler delegates to `reapplyRules`.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
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
}

/**
 * Create the catalog handler for `POST /rules/reapply`: re-applies current
 * inference rules to indexed files matching `globs` without re-embedding.
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
      ),
    }),
    deps.logger,
    'RulesReapply',
  );
}
