import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { createConfigMatchHandler } from './configMatch';

type ConfigMatchRequest = FastifyRequest<{
  Body: { paths: string[] };
}>;

interface MockReply {
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function mockRequest(body: { paths: string[] }): ConfigMatchRequest {
  return { body } as unknown as ConfigMatchRequest;
}

function mockReply(): MockReply {
  const r = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
    status: vi.fn().mockReturnThis(),
    sent: false,
  };
  return r as unknown as MockReply;
}

describe('POST /config/match handler', () => {
  it('returns matching rule names and watch scope per path', async () => {
    const config: JeevesWatcherConfig = {
      watch: { paths: ['docs/**/*.md'], ignored: ['docs/private/**'] },
      embedding: { provider: 'mock', model: 'test' },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
      inferenceRules: [
        {
          name: 'docs-md',
          description: 'Docs markdown',
          match: {
            type: 'object',
            properties: {
              file: {
                type: 'object',
                properties: {
                  path: { type: 'string', glob: 'docs/**/*.md' },
                },
              },
            },
          },
          schema: [],
        },
      ],
    };

    const handler = createConfigMatchHandler({
      getConfig: () => config,
      logger: pino({ level: 'silent' }),
    });

    const reply = mockReply();
    await handler(
      mockRequest({
        paths: ['docs/readme.md', 'docs/private/secret.md', 'src/index.ts'],
      }),
      reply as unknown as FastifyReply,
    );

    expect(reply.send).toHaveBeenCalledWith({
      matches: [
        { rules: ['docs-md'], watched: true },
        { rules: ['docs-md'], watched: false },
        { rules: [], watched: false },
      ],
    });
  });
});
