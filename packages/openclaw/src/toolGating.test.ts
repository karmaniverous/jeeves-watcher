import { describe, expect, it } from 'vitest';

import { CONFIG_ROOT_READERS } from './toolGating.js';

describe('CONFIG_ROOT_READERS', () => {
  it('lists only watcher_service', () => {
    expect(Object.keys(CONFIG_ROOT_READERS)).toEqual(['watcher_service']);
  });

  it.each([
    [{ action: 'install' }, true],
    [{ action: 'status' }, false],
    [{ action: 'uninstall' }, false],
    [{ action: 'start' }, false],
    [{}, false],
    [undefined, false],
  ])('watcher_service %j reads configRoot: %s', (params, expected) => {
    expect(CONFIG_ROOT_READERS.watcher_service?.(params)).toBe(expected);
  });
});
