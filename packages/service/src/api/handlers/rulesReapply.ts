/**
 * @module api/handlers/rulesReapply
 * Fastify route handler for POST /rules/reapply.
 * Re-applies current inference rules to already-indexed files matching given globs.
 */

import type { FastifyRequest } from 'fastify';
import picomatch from 'picomatch';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

export interface RulesReapplyDeps {
  processor: DocumentProcessorInterface;
  vectorStore: VectorStore;
  logger: pino.Logger;
}

type ReapplyRequest = FastifyRequest<{
  Body: { globs: string[] };
}>;

/**
 * Create handler for POST /rules/reapply.
 *
 * Scrolls through all indexed points, finds files matching the given globs,
 * and re-applies current inference rules without re-embedding.
 */
export function createRulesReapplyHandler(deps: RulesReapplyDeps) {
  return wrapHandler(
    async (request: ReapplyRequest) => {
      const { globs } = request.body;

      if (!Array.isArray(globs) || globs.length === 0) {
        throw new Error(
          'Missing required field: globs (non-empty string array)',
        );
      }

      const normalizedGlobs = globs.map((g) => normalizeSlashes(g));
      const isMatch = picomatch(normalizedGlobs, { dot: true, nocase: true });

      // Collect unique file paths matching the globs
      const matchingFiles = new Set<string>();
      for await (const point of deps.vectorStore.scroll()) {
        const filePath = point.payload['file_path'];
        if (typeof filePath === 'string' && isMatch(filePath)) {
          matchingFiles.add(filePath);
        }
      }

      deps.logger.info(
        { globs: normalizedGlobs, matchCount: matchingFiles.size },
        'Re-applying rules to matching files',
      );

      let updated = 0;
      for (const filePath of matchingFiles) {
        try {
          const result = await deps.processor.processRulesUpdate(filePath);
          if (result !== null) updated++;
        } catch (error) {
          deps.logger.warn(
            { filePath, err: error },
            'Failed to re-apply rules to file',
          );
        }
      }

      return {
        matched: matchingFiles.size,
        updated,
      };
    },
    deps.logger,
    'RulesReapply',
  );
}
