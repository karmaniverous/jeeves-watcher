/**
 * @module watcher/reconcile/RerunSet.test
 * The containment-merged rerun set (D179).
 */

import { describe, expect, it } from 'vitest';

import { RerunSet } from './RerunSet';

describe('RerunSet', () => {
  it('merges a/b, a, a/c into one pending a', () => {
    const set = new RerunSet();
    set.add('/r/a/b');
    set.add('/r/a');
    set.add('/r/a/c');
    expect(set.size).toBe(1);
    expect(set.take()).toEqual(['/r/a']);
  });

  it('keeps siblings and prefix-named neighbours apart', () => {
    const set = new RerunSet();
    set.add('/r/a');
    set.add('/r/ab');
    set.add('/r/b/c');
    expect(set.take().sort()).toEqual(['/r/a', '/r/ab', '/r/b/c']);
  });

  it('matches case-insensitively and drains on take', () => {
    const set = new RerunSet();
    set.add('C:\\R\\A');
    set.add('c:/r/a/x');
    expect(set.take()).toEqual(['C:\\R\\A']);
    expect(set.size).toBe(0);
    expect(set.take()).toEqual([]);
  });
});
