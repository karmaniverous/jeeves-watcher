import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';

// Mock executeReindex to avoid actual file processing
vi.mock('../executeReindex', () => ({
  executeReindex: vi.fn().mockResolvedValue({
    filesProcessed: 5,
    durationMs: 100,
    errors: 0,
  }),
}));

import { executeReindex } from '../executeReindex';
import type { Mock } from 'vitest';

const mockedExecuteReindex = executeReindex as Mock;

function createDeps() {
  return {
    config: {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test', dimensions: 3 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    } as any,
    processor: {} as any,
    logger: pino({ level: 'silent' }),
    reindexTracker: new ReindexTracker(),
  };
}

function mockRequest(body: Record<string, unknown> = {}) {
  return { body } as any;
}

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  } as any;
}

describe('createConfigReindexHandler', () => {
  it('returns started status with default rules scope', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(deps);
    const reply = mockReply();
    await handler(mockRequest({}), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ status: 'started', scope: 'rules' });
  });

  it('passes full scope when requested', async () => {
    const deps = createDeps();
    const handler = createConfigReindexHandler(deps);
    const reply = mockReply();
    await handler(mockRequest({ scope: 'full' }), reply);

    expect(reply.send).toHaveBeenCalledWith({ status: 'started', scope: 'full' });
    expect(mockedExecuteReindex).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.config }),
      'full',
    );
  });
});
