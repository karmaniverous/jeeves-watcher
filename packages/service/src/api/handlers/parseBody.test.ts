/**
 * @module api/handlers/parseBody.test
 * Tests for request-body validation.
 */

import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { parseBody } from './parseBody';

function mockReply() {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ send });
  return { reply: { status } as unknown as FastifyReply, status, send };
}

const schema = z.object({ name: z.string({ error: 'name is required' }) });

describe('parseBody', () => {
  it('returns parsed data and sends nothing for a valid body', () => {
    const { reply, status } = mockReply();
    expect(parseBody(schema, { name: 'a', extra: 1 }, reply)).toEqual({
      name: 'a',
    });
    expect(status).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { name: 3 }])(
    'sends 400 with Zod issues for %j',
    (body) => {
      const { reply, status, send } = mockReply();
      expect(parseBody(schema, body, reply)).toBeUndefined();
      expect(status).toHaveBeenCalledWith(400);
      const sent = send.mock.calls[0]?.[0] as {
        error: string;
        details: { path: unknown[] }[];
      };
      expect(sent.details.length).toBeGreaterThan(0);
      expect(typeof sent.error).toBe('string');
    },
  );

  it('uses the first issue message as error', () => {
    const { reply, send } = mockReply();
    parseBody(schema, {}, reply);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'name is required' }),
    );
  });
});
