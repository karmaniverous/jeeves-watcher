import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { createConfigSchemaHandler } from './configSchema';

type Req = FastifyRequest;

interface MockReply {
  send: ReturnType<typeof vi.fn>;
}

function mockReply(): MockReply {
  return {
    send: vi.fn().mockImplementation((d: unknown) => d),
  };
}

describe('GET /config/schema handler', () => {
  it('returns a JSON Schema document', async () => {
    const handler = createConfigSchemaHandler();
    const reply = mockReply();

    await handler({} as Req, reply as unknown as FastifyReply);

    expect(reply.send).toHaveBeenCalled();
    const schemaArg = reply.send.mock.calls[0][0] as Record<string, unknown>;
    expect(schemaArg).toHaveProperty('$schema');
  });
});
