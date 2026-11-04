/**
 * @module api/reapplyRules.test
 * reapplyRules: scrolls with a file_path-only projection, matches distinct paths case-insensitively with normalised slashes (source points never match), counts updates and logs per-file failures without stopping; a document-lock wait that runs out is rethrown (D118) after earlier files were updated, and the wait bound is passed through.
 */

import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { DocumentLockTimeoutError } from '../processor/DocumentLocks';
import { reapplyRules } from './reapplyRules';

describe('reapplyRules', () => {
  it('re-applies rules to matching indexed files only', async () => {
    const scrollPage = vi.fn().mockResolvedValue({
      points: [
        { id: '1', payload: { file_path: 'docs/A.md' } },
        { id: '2', payload: { file_path: 'docs/A.md' } },
        { id: '3', payload: { file_path: 'docs/b.md' } },
        { id: '4', payload: { file_path: 'other/c.md' } },
        { id: '5', payload: {} },
      ],
      nextCursor: undefined,
    });
    const processRulesUpdate = vi.fn((path: string) =>
      path === 'docs/b.md'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({}),
    );
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn } as unknown as pino.Logger;

    const result = await reapplyRules(
      { scrollPage },
      { processRulesUpdate },
      ['DOCS\\**'],
      logger,
    );

    expect(result).toEqual({ matched: 2, updated: 1 });
    expect(scrollPage).toHaveBeenCalledWith(undefined, 256, undefined, [
      'file_path',
    ]);
    expect(processRulesUpdate.mock.calls.map(([p]) => p).sort()).toEqual([
      'docs/A.md',
      'docs/b.md',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rethrows a document-lock timeout, keeping files already updated, and passes the wait', async () => {
    const scrollPage = vi.fn().mockResolvedValue({
      points: [
        { id: '1', payload: { file_path: 'a.md' } },
        { id: '2', payload: { file_path: 'b.md' } },
        { id: '3', payload: { file_path: 'c.md' } },
      ],
      nextCursor: undefined,
    });
    const updated: string[] = [];
    const processRulesUpdate = vi.fn((path: string) => {
      if (path === 'b.md') {
        return Promise.reject(
          new DocumentLockTimeoutError('b.md', 'reapplyRules', 10_000),
        );
      }
      updated.push(path);
      return Promise.resolve({});
    });
    const logger = { info: vi.fn(), warn: vi.fn() } as unknown as pino.Logger;

    await expect(
      reapplyRules({ scrollPage }, { processRulesUpdate }, ['**'], logger, {
        lockWaitMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(DocumentLockTimeoutError);
    expect(updated).toEqual(['a.md']);
    expect(processRulesUpdate).toHaveBeenCalledWith('a.md', {
      lockWaitMs: 10_000,
    });
    expect(processRulesUpdate).not.toHaveBeenCalledWith(
      'c.md',
      expect.anything(),
    );
  });
});
