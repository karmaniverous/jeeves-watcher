/**
 * @module api/catalog/configMatchHandler
 * Catalog handler for `POST /config/match`: tests file paths against the inference rules and the watch scope. The request (`paths`) is validated by the catalog's `configMatch` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import {
  extractWatchPathStrings,
  type MatchConfigResponse,
} from '@karmaniverous/jeeves-watcher-core';
import picomatch from 'picomatch';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import { buildSyntheticAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Match result for a single path. */
type PathMatch = MatchConfigResponse['matches'][number];

/** Dependencies for the catalog `configMatch` entry's handler. */
export interface CatalogConfigMatchDeps {
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /config/match`. The compiled rules
 * and watch matchers are cached per config object, so they are rebuilt only
 * after a hot reload.
 *
 * @param deps - Live config getter and logger.
 * @returns The catalog handler.
 */
export function createCatalogConfigMatchHandler(
  deps: CatalogConfigMatchDeps,
): CatalogHandler<Entry<'configMatch'>> {
  const { getConfig, logger } = deps;

  // Cache compiled artifacts per config reference; recompute only on hot-reload.
  let cachedConfig: JeevesWatcherConfig | undefined;
  let compiledRules: ReturnType<typeof compileRules> = [];
  let watchMatcher: ReturnType<typeof picomatch> | undefined;
  let ignoreMatcher: ReturnType<typeof picomatch> | undefined;

  return wrapCatalogHandler<Entry<'configMatch'>>(
    (input) => {
      const config = getConfig();
      if (config !== cachedConfig) {
        compiledRules = compileRules(config.inferenceRules ?? []);
        watchMatcher = picomatch(extractWatchPathStrings(config.watch.paths), {
          dot: true,
        });
        ignoreMatcher = config.watch.ignored.length
          ? picomatch(config.watch.ignored, { dot: true })
          : undefined;
        cachedConfig = config;
      }

      const matches: PathMatch[] = input.body.paths.map((path) => {
        const attrs = buildSyntheticAttributes(path);

        const matchingRules: string[] = [];
        for (const compiled of compiledRules) {
          if (compiled.validate(attrs)) {
            matchingRules.push(compiled.rule.name);
          }
        }

        const normalised = attrs.file.path;
        const watched =
          (watchMatcher?.(normalised) ?? false) &&
          !(ignoreMatcher?.(normalised) ?? false);

        return { rules: matchingRules, watched };
      });

      return Promise.resolve({ body: { matches } });
    },
    logger,
    'Config match',
  );
}
