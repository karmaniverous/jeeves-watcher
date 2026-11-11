/**
 * @module api/catalog/configHandler
 * `ConfigQueryHandler` source for the catalog `config` entry: core's generic
 * `createConfigQueryHandler` over the watcher's merged document (globals,
 * virtual rules, helper introspection); an invalid JSONPath is core's own
 * `400 JEEVES_CONFIG_QUERY_INVALID` (fitted to the catalog by
 * `standardHandlers`, `api/catalog/index`).
 */

import {
  type ConfigQueryHandler,
  createConfigQueryHandler,
} from '@karmaniverous/jeeves';

import type { JeevesWatcherConfig } from '../../config/types';
import type { AllHelpersIntrospection } from '../../helpers';
import type { IssuesManager } from '../../issues';
import type { ValuesManager } from '../../values';
import { buildMergedDocument } from '../mergedDocument';

/** Dependencies for the catalog `config` entry's source handler. */
export interface CatalogConfigDeps {
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Discovered metadata values. */
  valuesManager: ValuesManager;
  /** Recorded processing issues. */
  issuesManager: IssuesManager;
  /** Helper introspection, merged into the document when present. */
  helperIntrospection?: AllHelpersIntrospection;
  /** Virtual rules getter, merged into the document when present. */
  getVirtualRules?: () => Record<string, Record<string, unknown>[]>;
}

/**
 * Build the `ConfigQueryHandler` source for `GET /config`.
 *
 * @param deps - Live config getter, values/issues managers, and optional
 *   helper introspection and virtual rules getter.
 * @returns A `ConfigQueryHandler`, ready for `standardHandlers`.
 */
export function createCatalogConfigSource(
  deps: CatalogConfigDeps,
): ConfigQueryHandler {
  const coreHandler = createConfigQueryHandler(() =>
    buildMergedDocument({
      config: deps.getConfig(),
      valuesManager: deps.valuesManager,
      issuesManager: deps.issuesManager,
      helperIntrospection: deps.helperIntrospection,
      virtualRules: deps.getVirtualRules?.(),
    }),
  );

  // Async, so a failure building the merged document (thrown synchronously
  // by core's handler) rejects and reaches jeeves as a masked 500.
  return async (query) => coreHandler(query);
}
