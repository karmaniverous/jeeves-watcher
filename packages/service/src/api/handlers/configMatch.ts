/**
 * @module api/handlers/configMatch
 * Tests file paths against inference rules and watch scope.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import picomatch from 'picomatch';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import { buildSyntheticAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import { wrapHandler } from './wrapHandler';

/** Request body for POST /config/match. */
interface ConfigMatchRequest {
  paths: string[];
}

/** Match result for a single path. */
interface PathMatch {
  /** Ordered list of matching inference rule names. */
  rules: string[];
  /** Whether the path is within watch scope. */
  watched: boolean;
}

/** Response body for POST /config/match. */
interface ConfigMatchResponse {
  matches: PathMatch[];
}

/** Handler factory options. */
interface ConfigMatchHandlerOptions {
  getConfig: () => JeevesWatcherConfig;
  logger: pino.Logger;
}

/**
 * Factory for POST /config/match handler.
 *
 * @param options - Handler options.
 * @returns The handler function.
 */
export function createConfigMatchHandler(options: ConfigMatchHandlerOptions) {
  const { getConfig, logger } = options;

  // Cache compiled artifacts per config reference — recompute only on hot-reload.
  let cachedConfig: JeevesWatcherConfig | undefined;
  let compiledRules: ReturnType<typeof compileRules> = [];
  let watchMatcher: ReturnType<typeof picomatch> | undefined;
  let ignoreMatcher: ReturnType<typeof picomatch> | undefined;

  const handler = async (
    req: FastifyRequest,
    res: FastifyReply,
  ): Promise<void> => {
    const body = req.body as ConfigMatchRequest;

    if (!Array.isArray(body.paths)) {
      res.code(400).send({ error: 'Request body must include "paths" array' });
      return;
    }

    const config = getConfig();
    if (config !== cachedConfig) {
      compiledRules = compileRules(config.inferenceRules ?? []);
      watchMatcher = picomatch(config.watch.paths, { dot: true });
      ignoreMatcher = config.watch.ignored?.length
        ? picomatch(config.watch.ignored, { dot: true })
        : undefined;
      cachedConfig = config;
    }

    const matches: PathMatch[] = body.paths.map((path) => {
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

    const response: ConfigMatchResponse = { matches };
    res.send(response);
  };

  return wrapHandler(handler, logger, 'Config match');
}
