/**
 * @module watcher/changeSource/ParcelSource.windows.test
 * D196 against a stub module: on Windows the parcel source never unsubscribes. Stop drops the handles, an error on a live subscription or its root gone exits for a restart (named cause, no resubscribe), a subscribe that never succeeded still retries, renewal stays a no-op, and Linux keeps unsubscribing.
 */

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger, stubParcel, stubSink } from '../../test/parcelStub';
import { ParcelSource } from './ParcelSource';
import { BACKOFF_INITIAL_MS, BACKOFF_MAX_MS } from './parcelSubscription';
import { RESTART_EXIT_CODE } from './restart';

const R1 = join('/srv', 'r1');
const R2 = join('/srv', 'r2');

describe('ParcelSource on Windows (D196)', () => {
  let stub: ReturnType<typeof stubParcel>;
  let sink: ReturnType<typeof stubSink>;
  let logger: ReturnType<typeof createMockLogger>;
  let missing: Set<string>;
  let restart: ReturnType<typeof vi.fn>;

  const lstat = (path: string) =>
    missing.has(path)
      ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      : Promise.resolve({});

  function source(platform: NodeJS.Platform = 'win32', withRestarter = true) {
    return new ParcelSource({
      parcel: stub.parcel,
      ignored: [],
      stateDir: join('/state'),
      logger: logger as never,
      platform,
      lstat,
      ...(withRestarter ? { restarter: { restart } } : {}),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stub = stubParcel();
    sink = stubSink();
    logger = createMockLogger();
    missing = new Set();
    restart = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebuilds by restart on Windows only', () => {
    expect(source().restartsToRebuild).toBe(true);
    expect(source('linux').restartsToRebuild).toBe(false);
    expect(source('darwin').restartsToRebuild).toBe(false);
  });

  it('stop never unsubscribes, and silences callbacks', async () => {
    const parcelSource = source();
    await parcelSource.start([R1, R2], [], sink);
    await parcelSource.stop();
    expect(stub.log).toEqual([`subscribe ${R1}`, `subscribe ${R2}`]);
    stub.subs[0].callback(null, [{ path: join(R1, 'a'), type: 'create' }]);
    stub.subs[0].callback(new Error('late'), []);
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(sink.rawEvents).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('an error on a live subscription exits for a restart, without unsubscribing or resubscribing', async () => {
    await source().start([R1], [], sink);
    const error = new Error('Error reading changes');
    stub.latest(R1).callback(error, []);
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(restart).toHaveBeenCalledExactlyOnceWith({
      cause: 'subscription-error',
      root: R1,
      err: error,
    });
    expect(stub.log).toEqual([`subscribe ${R1}`]);
    expect(sink.resubscribed).not.toHaveBeenCalled();
    expect(sink.rootUnavailable).not.toHaveBeenCalled();
    stub.latest(R1).callback(new Error('again'), []);
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenCalledOnce();
  });

  it('a gone root exits for a restart named root-gone, from an error or a delete of the root', async () => {
    await source().start([R1, R2], [], sink);
    missing.add(R1);
    stub.latest(R1).callback(new Error('x'), []);
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenLastCalledWith(
      expect.objectContaining({ cause: 'root-gone', root: R1 }),
    );
    missing.add(R2);
    stub.latest(R2).callback(null, [{ path: R2, type: 'delete' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenLastCalledWith(
      expect.objectContaining({ cause: 'root-gone', root: R2 }),
    );
    expect(stub.log).toEqual([`subscribe ${R1}`, `subscribe ${R2}`]);
    expect(sink.rootUnavailable).not.toHaveBeenCalled();
  });

  it('a first subscribe that failed has nothing to release: it retries with backoff', async () => {
    stub.failNext.push(new Error('Error starting watcher'));
    missing.add(R1);
    await source().start([R1], [], sink);
    expect(sink.rootUnavailable).toHaveBeenCalledWith(R1, 'ENOENT');
    missing.delete(R1);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    expect(sink.rootAvailable).toHaveBeenCalledWith(R1);
    expect(restart).not.toHaveBeenCalled();
    expect(stub.log).toEqual([`subscribe ${R1}`, `subscribe ${R1}`]);
  });

  it('renew stays a no-op (D177)', async () => {
    const parcelSource = source();
    await parcelSource.start([R1], [], sink);
    await expect(parcelSource.renew(R1)).resolves.toEqual({ rebuilt: false });
    expect(stub.log).toEqual([`subscribe ${R1}`]);
  });

  it('without a restarter, logs the cause and exits with the restart code', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });
    try {
      await source('win32', false).start([R1], [], sink);
      stub.latest(R1).callback(new Error('boom'), []);
      await vi.advanceTimersByTimeAsync(0);
      expect(exit).toHaveBeenCalledExactlyOnceWith(RESTART_EXIT_CODE);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: 'subscription-error',
          exitCode: RESTART_EXIT_CODE,
          root: R1,
        }),
        expect.stringContaining('D196'),
      );
    } finally {
      exit.mockRestore();
    }
  });

  it('Linux keeps unsubscribing on stop and resubscribing after an error', async () => {
    const parcelSource = source('linux');
    await parcelSource.start([R1], [], sink);
    stub.latest(R1).callback(new Error('x'), []);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    expect(sink.resubscribed).toHaveBeenCalledWith(R1);
    await parcelSource.stop();
    expect(stub.log).toEqual([
      `subscribe ${R1}`,
      `unsubscribe ${R1}`,
      `subscribe ${R1}`,
      `unsubscribe ${R1}`,
    ]);
    expect(restart).not.toHaveBeenCalled();
  });
});
