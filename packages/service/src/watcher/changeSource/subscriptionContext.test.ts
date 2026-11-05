/**
 * @module watcher/changeSource/subscriptionContext.test
 * Reading a subscription error: its code, else its name, else `UnknownError`; a failed `inotify_add_watch` (D156) recognised by its message only.
 */

import { describe, expect, it } from 'vitest';

import { codeOf, isWatchLimitError } from './subscriptionContext';

describe('subscription errors', () => {
  it('reads the code, else the name, else UnknownError', () => {
    expect(codeOf(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(
      'ENOENT',
    );
    expect(codeOf(new TypeError('x'))).toBe('TypeError');
    expect(codeOf('a string')).toBe('UnknownError');
    expect(codeOf(undefined)).toBe('UnknownError');
    expect(codeOf({ code: 42 })).toBe('UnknownError');
  });

  it('recognises a failed inotify_add_watch by its message (D156)', () => {
    expect(
      isWatchLimitError(new Error('inotify_add_watch on /r failed: ENOSPC')),
    ).toBe(true);
    expect(isWatchLimitError(new Error('Error reading changes'))).toBe(false);
    expect(isWatchLimitError('inotify_add_watch')).toBe(false);
  });
});
