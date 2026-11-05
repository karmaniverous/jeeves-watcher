/**
 * @module watcher/filteredEvents.test
 * An `add` for a file the inventory already holds: dropped when it repeats a synthetic add (same settled stats), a change otherwise; the remembered synthetic adds are bounded and forgotten on unlink.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { FileEventActions } from './fileEvents';
import { FilteredEvents, MAX_SYNTHETIC_ADDS } from './filteredEvents';
import { Inventory } from './inventory/Inventory';
import type { WatchFilter } from './pathFilter';
import { ScanStats } from './ScanStats';

/** Handlers past the initial scan, with every path passing the filters. */
function setup() {
  const actions = {
    added: vi.fn(),
    changed: vi.fn(),
    removed: vi.fn(),
  };
  const filter = {
    isRootGit: () => false,
    globMatches: () => true,
    isGitignored: () => false,
    noteGitignoreChange: () => false,
  } as unknown as WatchFilter;
  const events = new FilteredEvents({
    filter,
    inventory: new Inventory(false),
    actions: actions as unknown as FileEventActions,
    scanStats: new ScanStats(['/r']),
    logger: pino({ level: 'silent' }),
    scanning: () => false,
    onGitignoreChange: () => undefined,
  });
  return { events, actions };
}

const settled = { size: 10, mtimeMs: 1000 };

describe('FilteredEvents: an add for a known file', () => {
  it('drops the source add that repeats a synthetic add with the same stats', () => {
    const { events, actions } = setup();
    events.add('/r/a.md', settled, true);
    events.add('/r/a.md', { ...settled });
    expect(actions.added).toHaveBeenCalledOnce();
    expect(actions.changed).not.toHaveBeenCalled();
  });

  it('turns it into a change when the stats moved on or are missing', () => {
    const { events, actions } = setup();
    events.add('/r/a.md', settled, true);
    events.add('/r/a.md', { size: 10, mtimeMs: 2000 });
    events.add('/r/b.md', settled, true);
    events.add('/r/b.md');
    expect(actions.added).toHaveBeenCalledTimes(2);
    expect(actions.changed.mock.calls.map((call) => String(call[0]))).toEqual([
      '/r/a.md',
      '/r/b.md',
    ]);
  });

  it('turns a repeated add without a synthetic one into a change (missed unlink)', () => {
    const { events, actions } = setup();
    events.add('/r/a.md', settled);
    events.add('/r/a.md', settled);
    expect(actions.added).toHaveBeenCalledOnce();
    expect(actions.changed).toHaveBeenCalledOnce();
  });

  it('forgets a synthetic add on unlink, so a re-created file is created again', () => {
    const { events, actions } = setup();
    events.add('/r/a.md', settled, true);
    events.unlink('/r/a.md');
    events.add('/r/a.md', settled);
    expect(actions.added).toHaveBeenCalledTimes(2);
    expect(actions.removed).toHaveBeenCalledOnce();
    // No stale synthetic stats: a later repeat is a change, not dropped.
    events.add('/r/a.md', settled);
    expect(actions.changed).toHaveBeenCalledOnce();
  });

  it('remembers at most MAX_SYNTHETIC_ADDS, dropping the oldest', () => {
    const { events, actions } = setup();
    for (let i = 0; i <= MAX_SYNTHETIC_ADDS; i++) {
      events.add(`/r/${String(i)}.md`, settled, true);
    }
    events.add('/r/0.md', settled);
    events.add('/r/1.md', settled);
    expect(actions.changed.mock.calls.map((call) => String(call[0]))).toEqual([
      '/r/0.md',
    ]);
  });
});
