/**
 * @module watcher/indexCheck/runIndexCheck.races.test
 * The index check (D197) against what happens while it runs: an event adding a candidate (during another path's stat, or its own), the service stopping during a stat, and the watcher stopping or being rebuilt (`failed` vs `stale`). Fake index and view.
 */

import { describe, expect, it, vi } from 'vitest';

import { runIndexCheck } from './runIndexCheck';
import { file, kept, PAD, setup } from './runIndexCheck.fixtures';

describe('runIndexCheck while events, stops and rebuilds happen', () => {
  it('leaves a candidate still on disk, and one an event added meanwhile', async () => {
    const pads = [kept('/r'), kept('/r/more')];
    const s = setup({
      inventory: pads.flatMap((p) => p.paths),
      gone: ['/r/added.md'],
      payloads: [
        ...pads.flatMap((p) => p.payloads),
        file('/r/present.md'),
        file('/r/added.md'),
      ],
    });
    s.deps.isGone = (path) => {
      if (path === '/r/present.md') {
        // The event for added.md lands while present.md is stat-checked.
        s.inventory.add('/r/added.md');
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    };
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([]);
    expect(s.health.snapshot()).toMatchObject({
      checked: 2 * PAD + 2,
      removed: 0,
      capped: 0,
    });
  });

  it('keeps a file an event re-adds while its own stat is in flight', async () => {
    const pad = kept('/r');
    const s = setup({
      inventory: pad.paths,
      payloads: [...pad.payloads, file('/r/back.md')],
    });
    s.deps.isGone = (path) => {
      // The file is re-created and its add lands before the stat answers.
      s.inventory.add(path);
      return Promise.resolve(true);
    };
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([]);
    expect(s.health.snapshot()).toMatchObject({ removed: 0, capped: 0 });
  });

  it('deletes nothing once the service stops during a stat', async () => {
    let stopping = false;
    const pad = kept('/r');
    const s = setup({
      inventory: pad.paths,
      payloads: [...pad.payloads, file('/r/gone.md')],
      stopped: () => stopping,
    });
    s.deps.isGone = () => {
      stopping = true;
      return Promise.resolve(true);
    };
    expect(await runIndexCheck(s.deps)).toBe('failed');
    expect(s.calls).toEqual([]);
  });

  it('stops before listing or deleting more once the service stops or the watcher is rebuilt', async () => {
    let stopping = false;
    const pad = [...kept('/r').payloads, ...kept('/r/more').payloads];
    const stopped = setup({
      inventory: pad.map((p) => String(p.file_path)),
      gone: ['/r/a.md', '/r/b.md'],
      payloads: [...pad, file('/r/a.md'), file('/r/b.md')],
      stopped: () => stopping,
    });
    stopped.deps.deleteFile = vi.fn(() => {
      stopping = true;
      return Promise.resolve();
    });
    // The service stopping is a failure, not a rebuild.
    expect(await runIndexCheck(stopped.deps)).toBe('failed');
    expect(stopped.deps.deleteFile).toHaveBeenCalledTimes(1);
    expect(stopped.health.snapshot()).toMatchObject({ state: 'failed' });

    const rebuilt = setup({
      gone: ['/r/a.md'],
      payloads: [file('/r/a.md')],
      live: () => false,
    });
    // A rebuild while the service runs on: the next watcher's check.
    expect(await runIndexCheck(rebuilt.deps)).toBe('stale');
    expect(rebuilt.store.scrollPage).not.toHaveBeenCalled();
    expect(rebuilt.calls).toEqual([]);
    expect(rebuilt.health.snapshot()).toMatchObject({ state: 'failed' });
  });
});
