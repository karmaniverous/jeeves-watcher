/**
 * @module api/handlers/parseBody.test
 * parseBody returns the parsed value, or throws a 400 invalid_request RequestError carrying the first issue message and the full Zod issue list.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RequestError } from '../requestError';
import { parseBody } from './parseBody';

const schema = z.object({ name: z.string({ error: 'name is required' }) });

/** The error parseBody throws for a body. */
function failure(body: unknown): RequestError {
  try {
    parseBody(schema, body);
  } catch (error) {
    if (error instanceof RequestError) return error;
    throw error;
  }
  throw new Error('parseBody did not throw');
}

describe('parseBody', () => {
  it('returns parsed data for a valid body', () => {
    expect(parseBody(schema, { name: 'a', extra: 1 })).toEqual({ name: 'a' });
  });

  it.each([undefined, null, {}, { name: 3 }])(
    'throws 400 invalid_request with Zod issues for %j',
    (body) => {
      const error = failure(body);
      expect(error).toMatchObject({ status: 400, code: 'invalid_request' });
      expect(
        (error.extras.details as Array<{ path: unknown[] }>).length,
      ).toBeGreaterThan(0);
    },
  );

  it('uses the first issue message as error', () => {
    expect(failure({}).message).toBe('name is required');
  });
});
