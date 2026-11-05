/**
 * @module watcher/batch/BatchFifo.test
 * The serial batch queue (D149): arrival order, one task at a time, per-root pauses, a throwing task logged without stopping the queue, and stop.
 */

import { describe, expect, it, vi } from 'vitest';

import { BatchFifo } from './BatchFifo';

describe('BatchFifo', () => {
  it('runs tasks one at a time, in order', async () => {
    const fifo = new BatchFifo({ error: vi.fn() } as never);
    const log: string[] = [];
    let active = 0;
    for (const name of ['a', 'b', 'c']) {
      fifo.push('/r', async () => {
        active += 1;
        expect(active).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(name);
        active -= 1;
      });
    }
    await fifo.idle();
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it("holds a paused root's tasks; other roots go on; resume releases them in order", async () => {
    const fifo = new BatchFifo({ error: vi.fn() } as never);
    const log: string[] = [];
    fifo.pause('/r1');
    fifo.pause('/r1');
    fifo.push('/r1', () => void log.push('r1-a'));
    fifo.push('/r2', () => void log.push('r2'));
    fifo.push(undefined, () => void log.push('timer'));
    fifo.push('/r1', () => void log.push('r1-b'));
    await fifo.idle();
    expect(log).toEqual(['r2', 'timer']);
    fifo.resume('/r1');
    fifo.resume('/r3');
    await fifo.idle();
    expect(log).toEqual(['r2', 'timer', 'r1-a', 'r1-b']);
  });

  it('logs a failing task and keeps going', async () => {
    const error = vi.fn();
    const fifo = new BatchFifo({ error } as never);
    const log: string[] = [];
    fifo.push('/r', () => {
      throw new Error('bug');
    });
    fifo.push('/r', () => void log.push('next'));
    await fifo.idle();
    expect(log).toEqual(['next']);
    expect(error).toHaveBeenCalledOnce();
  });

  it('runs nothing after stop, and drops held work', async () => {
    const fifo = new BatchFifo({ error: vi.fn() } as never);
    const log: string[] = [];
    fifo.pause('/r');
    fifo.push('/r', () => void log.push('held'));
    fifo.stop();
    fifo.push('/x', () => void log.push('late'));
    fifo.resume('/r');
    await fifo.idle();
    expect(log).toEqual([]);
  });
});
