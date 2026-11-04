/**
 * @module api/catalog/configMatchHandler
 * Catalog handler for `POST /config/match`: tests file paths against the inference rules and the watch scope. The request (`paths`) is validated by the catalog's `matchConfig` entry schema.
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

/** What a config compiles to for matching. */
interface CompiledConfig {
  /** The config these were compiled from. */
  config: JeevesWatcherConfig;
  /** Compiled inference rules. */
  rules: ReturnType<typeof compileRules>;
  /** Matches the watch paths. */
  watch: ReturnType<typeof picomatch>;
  /** Matches `watch.ignored`, if any. */
  ignore?: ReturnType<typeof picomatch>;
}

/**
 * Compile a config's inference rules and watch matchers. Pure.
 *
 * @param config - The config.
 * @returns The compiled rules and matchers.
 */
function compileConfig(config: JeevesWatcherConfig): CompiledConfig {
  return {
    config,
    rules: compileRules(config.inferenceRules ?? []),
    watch: picomatch(extractWatchPathStrings(config.watch.paths), {
      dot: true,
    }),
    ignore: config.watch.ignored.length
      ? picomatch(config.watch.ignored, { dot: true })
      : undefined,
  };
}

/** Dependencies for the catalog `matchConfig` entry's handler. */
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
): CatalogHandler<Entry<'matchConfig'>> {
  const { getConfig, logger } = deps;

  // Cache compiled artifacts per config reference; recompute only on hot-reload.
  let cached: CompiledConfig | undefined;

  return wrapCatalogHandler<Entry<'matchConfig'>>(
    (input) => {
      const config = getConfig();
      if (cached?.config !== config) cached = compileConfig(config);
      const { rules, watch, ignore } = cached;

      const matches: PathMatch[] = input.body.paths.map((path) => {
        const attrs = buildSyntheticAttributes(path);

        const matchingRules: string[] = [];
        for (const compiled of rules) {
          if (compiled.validate(attrs)) {
            matchingRules.push(compiled.rule.name);
          }
        }

        const normalised = attrs.file.path;
        const watched = watch(normalised) && !ignore?.(normalised);

        return { rules: matchingRules, watched };
      });

      return Promise.resolve({ body: { matches } });
    },
    logger,
    'Config match',
  );
}
