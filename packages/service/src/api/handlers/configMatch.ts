/**
 * @module api/handlers/configMatch
 * Tests file paths against inference rules and watch scope.
 */

import { basename, dirname, extname } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import picomatch from 'picomatch';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { FileAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import { normalizeSlashes } from '../../util/normalizeSlashes';
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
export interface ConfigMatchHandlerOptions {
  config: JeevesWatcherConfig;
  logger: pino.Logger;
}

/**
 * Factory for POST /config/match handler.
 *
 * @param options - Handler options.
 * @returns The handler function.
 */
export function createConfigMatchHandler(options: ConfigMatchHandlerOptions) {
  const { config, logger } = options;

  // Compile rules once at handler creation time
  const compiledRules = compileRules(config.inferenceRules ?? []);

  // Compile watch path matchers
  const watchMatcher = picomatch(config.watch.paths, { dot: true });
  const ignoreMatcher = config.watch.ignored?.length
    ? picomatch(config.watch.ignored, { dot: true })
    : null;

  const handler = async (
    req: FastifyRequest,
    res: FastifyReply,
  ): Promise<void> => {
    const body = req.body as ConfigMatchRequest;

    if (!Array.isArray(body.paths)) {
      res.code(400).send({ error: 'Request body must include "paths" array' });
      return;
    }

    const matches: PathMatch[] = body.paths.map((path) => {
      const normalised = normalizeSlashes(path);
      const attrs: FileAttributes = {
        file: {
          path: normalised,
          directory: normalizeSlashes(dirname(normalised)),
          filename: basename(normalised),
          extension: extname(normalised),
          sizeBytes: 0,
          modified: new Date(0).toISOString(),
        },
      };

      // Find matching rules
      const matchingRules: string[] = [];
      for (const compiled of compiledRules) {
        if (compiled.validate(attrs)) {
          matchingRules.push(compiled.rule.name);
        }
      }

      // Check watch scope: matches watch paths and not in ignored
      const watched = watchMatcher(normalised) && !ignoreMatcher?.(normalised);

      return { rules: matchingRules, watched };
    });

    const response: ConfigMatchResponse = { matches };
    res.send(response);
  };

  return wrapHandler(handler, logger, 'Config match');
}
