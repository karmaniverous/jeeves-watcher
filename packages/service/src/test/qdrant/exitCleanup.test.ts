/**
 * @module test/qdrant/exitCleanup.test
 * Tests for abnormal-exit cleanup hooks against a fake process: runs once on exit or signal, exits only when unhandled, unregisters cleanly.
 */

import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { registerExitCleanup } from './exitCleanup';

/** A minimal process stand-in with a spied `exit`. */
function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  const proc = Object.assign(emitter, { exit });
  return { proc: proc as unknown as NodeJS.Process, emitter, exit };
}

describe('registerExitCleanup', () => {
  it('runs cleanup once on exit', () => {
    const { proc, emitter } = fakeProcess();
    const cleanup = vi.fn();
    registerExitCleanup(cleanup, proc);
    emitter.emit('exit', 0);
    emitter.emit('exit', 0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('on an unhandled signal, cleans up then exits with 128+n', () => {
    const { proc, emitter, exit } = fakeProcess();
    const cleanup = vi.fn();
    registerExitCleanup(cleanup, proc);
    emitter.emit('SIGINT');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('leaves exiting to another signal listener when present', () => {
    const { proc, emitter, exit } = fakeProcess();
    const other = vi.fn();
    emitter.on('SIGTERM', other);
    const cleanup = vi.fn();
    registerExitCleanup(cleanup, proc);
    emitter.emit('SIGTERM');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('swallows cleanup errors', () => {
    const { proc, emitter } = fakeProcess();
    registerExitCleanup(() => {
      throw new Error('boom');
    }, proc);
    expect(() => emitter.emit('exit', 1)).not.toThrow();
  });

  it('unregister removes every hook', () => {
    const { proc, emitter } = fakeProcess();
    const cleanup = vi.fn();
    const unregister = registerExitCleanup(cleanup, proc);
    unregister();
    emitter.emit('exit', 0);
    expect(cleanup).not.toHaveBeenCalled();
    for (const event of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(emitter.listenerCount(event)).toBe(0);
    }
  });
});
