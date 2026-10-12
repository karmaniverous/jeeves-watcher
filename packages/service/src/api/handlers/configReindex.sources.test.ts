/**
 * @module api/handlers/configReindex.sources.test
 * POST /reindex (explicit request) asks executeReindex to cover source documents, for the plan and the run alike.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { executeReindex } from '../executeReindex';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';

vi.mock('../executeReindex', () => ({
  executeReindex: vi.fn().mockResolvedValue({
    filesProcessed: 0,
    durationMs: 0,
    errors: 0,
    plan: { total: 2, toProcess: 2, toDelete: 0, byRoot: { cg: 2 } },
  }),
}));

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

describe('POST /reindex: source documents', () => {
  it.each(['full', 'rules', 'issues'] as const)(
    'explicit %s requests include sources',
    async (scope) => {
      const mocked = vi.mocked(executeReindex);
      mocked.mockClear();
      const handler = createConfigReindexHandler({
        getConfig: () =>
          ({ watch: { paths: [] } }) as unknown as JeevesWatcherConfig,
        processor: {} as unknown as DocumentProcessor,
        logger: pino({ level: 'silent' }),
        reindexTracker: new ReindexTracker(),
      }) as unknown as Handler;
      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockImplementation((d: unknown) => d),
      };

      await handler(
        { body: { scope } } as unknown as FastifyRequest,
        reply as unknown as FastifyReply,
      );

      expect(mocked).toHaveBeenCalledTimes(2);
      for (const [deps] of mocked.mock.calls) {
        expect(deps.includeSources).toBe(true);
      }
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: expect.objectContaining({ byRoot: { cg: 2 } }) as unknown,
        }),
      );
    },
  );
});
