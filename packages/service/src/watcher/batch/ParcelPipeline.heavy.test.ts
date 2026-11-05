/**
 * @module watcher/batch/ParcelPipeline.heavy.test
 * Scale (D149): a 20K-file directory delete under a 120K-file inventory keeps the event loop responsive. In the serial `heavy` vitest project.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { ev, ROOT, setup } from '../../test/parcelPipelineHarness';
import type { RawChangeEvent } from '../changeSource/types';

describe('ParcelPipeline at scale', () => {
  it('a 20K-file directory delete under a 120K-file inventory keeps the loop delay under 100 ms (D149)', async () => {
    const { pipeline, inventory } = setup(
      {},
      {
        lstat: (path) =>
          new Promise((resolve) =>
            setImmediate(() => {
              resolve(path === ROOT ? 'dir' : 'absent');
            }),
          ),
      },
    );
    for (let i = 0; i < 100_000; i++) {
      inventory.set(`/r/keep/d${String(i % 500)}/f${String(i)}.md`, {
        size: 1,
        mtimeMs: 1,
      });
    }
    const batch: RawChangeEvent[] = [ev('delete', '/r/big')];
    for (let i = 0; i < 20_000; i++) {
      const path = `/r/big/d${String(i % 200)}/f${String(i)}.md`;
      inventory.set(path, { size: 1, mtimeMs: 1 });
      batch.push(ev('delete', path));
    }
    for (let d = 0; d < 200; d++)
      batch.push(ev('delete', `/r/big/d${String(d)}`));
    expect(inventory.size).toBe(120_000);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    pipeline.push(ROOT, batch);
    await pipeline.fifo.idle();
    delay.disable();
    expect(inventory.size).toBe(100_000);
    expect(delay.max / 1e6).toBeLessThan(100);
  }, 60_000);
});
