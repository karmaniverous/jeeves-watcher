/**
 * @module watcher/changeSource/ParcelSource.test
 * The parcel source against a stub module: subscriptions per root with the explicit backend and ignore list, handle-only unsubscribe (D179), a callback that never throws (D179), resubscribe with backoff (D131), root gone and back (D109), non-transient watch errors (D156), load failure at subscribe (D156). Renewal: ParcelSource.renew.test.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createMockLogger, stubParcel, stubSink } from '../../test/parcelStub';
import { ChangeSourceLoadError } from './parcelModule';
import { ParcelSource } from './ParcelSource';
import { BACKOFF_INITIAL_MS, BACKOFF_MAX_MS } from './parcelSubscription';

const R1 = join('/srv', 'r1');
const R2 = join('/srv', 'r2');
/** A real state dir: the rebuild creates the sentinel directory in it. */
const STATE = mkdtempSync(join(tmpdir(), 'parcel-source-state-'));

describe('ParcelSource', () => {
  let stub: ReturnType<typeof stubParcel>;
  let sink: ReturnType<typeof stubSink>;
  let logger: ReturnType<typeof createMockLogger>;
  let missing: Set<string>;

  const lstat = (path: string) =>
    missing.has(path)
      ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      : Promise.resolve({});

  function source(platform: NodeJS.Platform = 'linux', ignored: string[] = []) {
    return new ParcelSource({
      parcel: stub.parcel,
      ignored,
      stateDir: STATE,
      logger: logger as never,
      platform,
      lstat,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stub = stubParcel();
    sink = stubSink();
    logger = createMockLogger();
    missing = new Set();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    rmSync(STATE, { recursive: true, force: true });
  });

  it('is a walk-based source named parcel', () => {
    expect(source()).toMatchObject({ name: 'parcel', initialSet: 'walk' });
  });

  it('subscribes each root with the explicit backend and its ignore list', async () => {
    await source('linux', ['**/node_modules/**', '/srv/r1/tmp/**']).start(
      [R1, R2],
      [],
      sink,
    );
    expect(stub.subs.map((s) => [s.dir, s.options])).toEqual([
      [
        R1,
        {
          backend: 'inotify',
          ignore: ['.git', '**/node_modules/**', 'tmp/**'],
        },
      ],
      [R2, { backend: 'inotify', ignore: ['.git', '**/node_modules/**'] }],
    ]);
    const windows = stubParcel();
    stub = windows;
    await source('win32').start([R1], [], sink);
    expect(windows.subs[0]?.options).toMatchObject({ backend: 'windows' });
  });

  it('hands whole batches to the sink', async () => {
    await source().start([R1], [], sink);
    const events = [
      { path: join(R1, 'a.md'), type: 'create' as const },
      { path: join(R1, 'b.md'), type: 'update' as const },
    ];
    stub.latest(R1).callback(null, events);
    expect(sink.rawEvents).toHaveBeenCalledWith(R1, events);
  });

  it('never throws into parcel; logs root and batch size; next batch still handled', async () => {
    await source().start([R1], [], sink);
    sink.rawEvents.mockImplementationOnce(() => {
      throw new Error('handler bug');
    });
    const batch = [{ path: join(R1, 'a.md'), type: 'create' as const }];
    expect(() => {
      stub.latest(R1).callback(null, batch);
    }).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ root: R1, events: 1 }),
      expect.any(String),
    );
    stub.latest(R1).callback(null, batch);
    expect(sink.rawEvents).toHaveBeenCalledTimes(2);
  });

  it('resubscribes with backoff after an error while the root is present (D131)', async () => {
    await source().start([R1], [], sink);
    const first = stub.latest(R1);
    first.callback(new Error('Events were dropped'), []);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(stub.subs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    expect(stub.subs).toHaveLength(2);
    expect(sink.resubscribed).toHaveBeenCalledWith(R1);
    expect(sink.rootUnavailable).not.toHaveBeenCalled();
  });

  it('doubles the delay while resubscribing keeps failing, capped at 5 min', async () => {
    await source().start([R1], [], sink);
    stub.failNext.push(...Array.from({ length: 12 }, () => new Error('busy')));
    stub.latest(R1).callback(new Error('x'), []);
    const delays: number[] = [];
    let at = 0;
    for (let i = 0; i < 12; i++) {
      const before = stub.log.length;
      let waited = 0;
      while (stub.log.length === before) {
        await vi.advanceTimersByTimeAsync(1000);
        waited += 1000;
      }
      delays.push(waited);
      at += waited;
    }
    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16_000]);
    expect(Math.max(...delays)).toBe(BACKOFF_MAX_MS);
    expect(at).toBeGreaterThan(BACKOFF_MAX_MS);
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(sink.resubscribed).toHaveBeenCalledTimes(1);
  });

  it('marks a gone root unavailable once, retries, and reports it back (D109)', async () => {
    await source().start([R1], [], sink);
    missing.add(R1);
    stub.latest(R1).callback(new Error('x'), []);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.rootUnavailable).toHaveBeenCalledWith(R1, 'ENOENT');
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS * 3);
    expect(sink.rootUnavailable).toHaveBeenCalledTimes(1);
    missing.delete(R1);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS * 4);
    expect(sink.rootAvailable).toHaveBeenCalledWith(R1);
    expect(sink.resubscribed).not.toHaveBeenCalled();
  });

  it('treats a delete naming the root as root gone only when lstat fails', async () => {
    await source().start([R1], [], sink);
    const batch = [{ path: R1, type: 'delete' as const }];
    stub.latest(R1).callback(null, batch);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.rawEvents).toHaveBeenCalledWith(R1, batch);
    missing.add(R1);
    stub.latest(R1).callback(null, batch);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.rootUnavailable).toHaveBeenCalledWith(R1, 'ENOENT');
    expect(sink.rawEvents).toHaveBeenCalledTimes(1);
  });

  it('leaves a root unwatched after a failed inotify_add_watch (D156)', async () => {
    await source().start([R1], [], sink);
    const error = Object.assign(
      new Error(
        'inotify_add_watch on /srv/r1/x failed: No space left on device',
      ),
      { code: 'ENOSPC' },
    );
    stub.latest(R1).callback(error, []);
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
    expect(sink.rootUnavailable).toHaveBeenCalledWith(R1, 'ENOSPC', {
      reachable: true,
    });
    expect(stub.subs).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('fs.inotify.max_user_watches'),
    );
  });

  it('a first subscribe that fails to load the binding rejects start (D156)', async () => {
    stub.failNext.push(
      Object.assign(new Error('dlopen'), { code: 'ERR_DLOPEN_FAILED' }),
    );
    await expect(source().start([R1], [], sink)).rejects.toBeInstanceOf(
      ChangeSourceLoadError,
    );
  });

  it('any other first-subscribe failure takes the error path (D131)', async () => {
    stub.failNext.push(new Error('Error starting watcher'));
    await source().start([R1], [], sink);
    expect(stub.subs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    expect(stub.subs).toHaveLength(1);
    expect(sink.resubscribed).toHaveBeenCalledWith(R1);
  });

  it('stop unsubscribes every handle, cancels retries and silences callbacks', async () => {
    const parcelSource = source();
    await parcelSource.start([R1, R2], [], sink);
    const [s1, s2] = stub.subs;
    s2.callback(new Error('x'), []);
    await vi.advanceTimersByTimeAsync(0);
    await parcelSource.stop();
    expect(s1.unsubscribe).toHaveBeenCalledTimes(1);
    expect(s2.unsubscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(stub.subs).toHaveLength(2);
    s1.callback(null, [{ path: join(R1, 'a'), type: 'create' }]);
    s1.callback(new Error('late'), []);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.rawEvents).not.toHaveBeenCalled();
    expect(sink.resubscribed).not.toHaveBeenCalled();
  });

  it('logs and survives a rejected unsubscribe on stop', async () => {
    const parcelSource = source();
    await parcelSource.start([R1], [], sink);
    stub.rejectUnsubscribe.add(R1);
    await expect(parcelSource.stop()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ root: R1 }),
      'Parcel unsubscribe rejected',
    );
  });
});
