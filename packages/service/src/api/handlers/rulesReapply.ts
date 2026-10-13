/**
 * @module api/handlers/rulesReapply
 * Fastify route handler for POST /rules/reapply: parses the body (core `rulesReapplyRequestSchema`) and delegates to `reapplyRules`.
 */

import { rulesReapplyRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import type { VectorStore } from '../../vectorStore';
import { reapplyRules } from '../reapplyRules';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

interface RulesReapplyDeps {
  /** Document processor (re-applies rules per file). */
  processor: DocumentProcessorInterface;
  /** Vector store scrolled for indexed file paths. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

type ReapplyRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /rules/reapply: re-applies current inference rules
 * to indexed files matching `globs` without re-embedding. Missing or
 * malformed `globs` are `400 invalid_request`.
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler (`{ matched, updated }`).
 */
export function createRulesReapplyHandler(deps: RulesReapplyDeps) {
  return wrapHandler(
    async (request: ReapplyRequest) => {
      const { globs } = parseBody(
        rulesReapplyRequestSchema,
        request.body ?? {},
      );
      return reapplyRules(deps.vectorStore, deps.processor, globs, deps.logger);
    },
    deps.logger,
    'RulesReapply',
  );
}
