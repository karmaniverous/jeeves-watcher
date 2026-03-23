/**
 * @module queue/watchEventMove.test
 * Tests for WatchEvent move type extension.
 */

import { describe, expect, it } from 'vitest';

import type { WatchEvent } from './index';

describe('WatchEvent move type', () => {
  it('accepts move type with oldPath', () => {
    const event: WatchEvent = {
      type: 'move',
      path: '/new/location.txt',
      oldPath: '/old/location.txt',
      priority: 'normal',
    };
    expect(event.type).toBe('move');
    expect(event.oldPath).toBe('/old/location.txt');
    expect(event.path).toBe('/new/location.txt');
  });

  it('oldPath is optional for non-move events', () => {
    const event: WatchEvent = {
      type: 'create',
      path: '/some/file.txt',
      priority: 'normal',
    };
    expect(event.oldPath).toBeUndefined();
  });
});
