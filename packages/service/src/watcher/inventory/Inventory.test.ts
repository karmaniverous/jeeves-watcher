/**
 * @module watcher/inventory/Inventory.test
 * The inventory (D99): normalized keys, stats only when tracked, and subtree reads through the directory index without scanning the inventory (D127, D150).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Inventory } from './Inventory';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Inventory', () => {
  it('keys paths by normalized document key and keeps the reported path', () => {
    const inventory = new Inventory(false);
    inventory.set('C:\\Root\\A.md');
    expect(inventory.get('c:/root/a.md')).toEqual({ path: 'C:\\Root\\A.md' });
    expect(inventory.size).toBe(1);
    inventory.set('c:/root/a.md');
    expect(inventory.size).toBe(1);
  });

  it('stores stats only when it tracks them', () => {
    const stats = { size: 3, mtimeMs: 7 };
    const untracked = new Inventory(false);
    untracked.set('/r/a', stats);
    expect(untracked.get('/r/a')).toEqual({ path: '/r/a' });
    const tracked = new Inventory(true);
    tracked.set('/r/a', stats);
    expect(tracked.get('/r/a')).toEqual({ path: '/r/a', size: 3, mtimeMs: 7 });
    tracked.set('/r/a');
    expect(tracked.get('/r/a')).toEqual({ path: '/r/a' });
  });

  it('deletes entries and reports whether one was present', () => {
    const inventory = new Inventory(false);
    inventory.set('/r/d/a');
    expect(inventory.delete('/R/D/A')).toBe(true);
    expect(inventory.delete('/r/d/a')).toBe(false);
    expect(inventory.entriesUnder('/r')).toEqual(new Map());
  });

  it('reads a subtree without iterating the inventory map (D150)', () => {
    const inventory = new Inventory(false);
    for (let d = 0; d < 1000; d++) {
      for (let f = 0; f < 10; f++) {
        inventory.set(`/r/t/d${String(d)}/f${String(f)}`);
      }
    }
    for (let i = 0; i < 30_000; i++) inventory.set(`/r/other/o${String(i)}`);
    const spies = (['entries', 'values', 'keys', 'forEach'] as const).map(
      (name) => vi.spyOn(Map.prototype, name),
    );
    const under = inventory.entriesUnder('/R/T');
    expect(under.size).toBe(10_000);
    expect(under.get('/r/t/d999/f9')).toEqual({ path: '/r/t/d999/f9' });
    const scans = spies.flatMap((spy) =>
      spy.mock.contexts.filter(
        (map) => map instanceof Map && map.size > 25_000,
      ),
    );
    expect(scans).toEqual([]);
  });
});
