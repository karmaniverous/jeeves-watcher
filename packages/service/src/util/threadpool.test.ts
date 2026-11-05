/**
 * @module util/threadpool.test
 * `UV_THREADPOOL_SIZE` defaults to 16 and a set value is kept (D170).
 */

import { describe, expect, it } from 'vitest';

import { ensureThreadpoolSize } from './threadpool';

describe('ensureThreadpoolSize', () => {
  it('sets 16 when unset', () => {
    const env: NodeJS.ProcessEnv = {};
    ensureThreadpoolSize(env);
    expect(env.UV_THREADPOOL_SIZE).toBe('16');
  });

  it('keeps a value already set', () => {
    const env: NodeJS.ProcessEnv = { UV_THREADPOOL_SIZE: '6' };
    ensureThreadpoolSize(env);
    expect(env.UV_THREADPOOL_SIZE).toBe('6');
  });
});
