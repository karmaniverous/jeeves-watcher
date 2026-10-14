/**
 * @module api/handlers/configReindex.sources.test
 * POST /reindex (explicit request) covers source documents: the targets are prepared once with includeSources and the run reuses them.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { executeReindex, prepareReindex } from '../executeReindex';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';

const PREPARED = {
  plan: { total: 2, toProcess: 2, toDelete: 0, byRoot: { app: 2 } },
  fileList: [],
  sources: undefined,
};

vi.mock('../executeReindex', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeReindex: vi.fn(),
  prepareReindex: vi.fn(),
}));

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

describe('POST /reindex: source documents', () => {
  it.each(['full', 'rules', 'issues'] as const)(
    'explicit %s requests include sources',
    async (scope) => {
      const prepare = vi.mocked(prepareReindex);
      const execute = vi.mocked(executeReindex);
      prepare.mockReset().mockResolvedValue(PREPARED);
      execute.mockReset().mockResolvedValue({
        filesProcessed: 0,
        durationMs: 0,
        errors: 0,
      });
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

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(prepare.mock.calls[0][0].includeSources).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][0].includeSources).toBe(true);
      expect(execute.mock.calls[0][1].prepared).toBe(PREPARED);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ plan: PREPARED.plan }),
      );
    },
  );
});
