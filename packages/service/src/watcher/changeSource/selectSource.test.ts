/**
 * @module watcher/changeSource/selectSource.test
 * Source selection (D61, D125): polling forces chokidar, `watch.changeSource` decides otherwise, parcel by default.
 */

import { describe, expect, it } from 'vitest';

import { selectedChangeSource } from './selectSource';

describe('selectedChangeSource', () => {
  it.each([
    [{}, 'parcel'],
    [{ changeSource: 'parcel' }, 'parcel'],
    [{ changeSource: 'chokidar' }, 'chokidar'],
    [{ usePolling: false, changeSource: 'chokidar' }, 'chokidar'],
    [{ usePolling: true }, 'chokidar'],
    [{ usePolling: true, changeSource: 'parcel' }, 'chokidar'],
  ] as const)('%j -> %s', (watch, expected) => {
    expect(selectedChangeSource(watch)).toBe(expected);
  });
});
