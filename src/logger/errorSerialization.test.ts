/**
 * @module logger/errorSerialization.test
 *
 * Ensures pino logs normalized errors with useful message + stack (avoids `error: {}` output).
 */

import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { normalizeError } from '../util/normalizeError';

describe('pino error serialization', () => {
  it('serializes err with message and stack', () => {
    const chunks: string[] = [];

    const stream = new Writable({
      write(chunk: unknown, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });

    const logger = pino(
      {
        level: 'info',
      },
      stream,
    );

    logger.error(
      { err: normalizeError('boom') },
      'Something went wrong',
    );

    const line = chunks.join('').trim().split('\n').filter(Boolean).at(-1);
    expect(line).toBeDefined();

    const parsed = JSON.parse(line as string) as Record<string, unknown>;
    expect(parsed['msg']).toBe('Something went wrong');

    const err = parsed['err'] as Record<string, unknown>;
    expect(err).toBeDefined();
    expect(err['message']).toBe('boom');
    expect(String(err['stack'])).toContain('Error: boom');
  });
});
