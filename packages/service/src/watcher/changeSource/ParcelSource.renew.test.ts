/**
 * @module watcher/changeSource/ParcelSource.renew.test
 * Subscription renewal against a stub module: Linux awaits the unsubscribe before subscribing (D129) and rebuilds every subscription through a sentinel when it rejects, counting rejections inside the rebuild (D165, D176); a renewal whose subscribe fails takes the error path (D131); Windows renews nothing (D177).
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
import { ParcelSource, SENTINEL_DIR } from './ParcelSource';
import { BACKOFF_INITIAL_MS } from './parcelSubscription';

const R1 = join('/srv', 'r1');
const R2 = join('/srv', 'r2');
/** A real state dir: the rebuild creates the sentinel directory in it. */
const STATE = mkdtempSync(join(tmpdir(), 'parcel-source-state-'));

describe('ParcelSource.renew', () => {
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

  describe('renew', () => {
    it('does nothing on Windows (D177)', async () => {
      const parcelSource = source('win32');
      await parcelSource.start([R1], [], sink);
      stub.log.length = 0;
      await expect(parcelSource.renew(R1)).resolves.toEqual({ rebuilt: false });
      expect(stub.log).toEqual([]);
    });

    it('awaits the unsubscribe before subscribing on Linux (D129)', async () => {
      const parcelSource = source();
      await parcelSource.start([R1, R2], [], sink);
      stub.log.length = 0;
      const result = await parcelSource.renew(R1);
      expect(stub.log).toEqual([`unsubscribe ${R1}`, `subscribe ${R1}`]);
      expect(result.rebuilt).toBe(false);
      expect(result.durationMs).toEqual(expect.any(Number));
      expect(result.rebuildFailures).toBeUndefined();
    });

    it('renews nothing for a root that is not subscribed', async () => {
      const parcelSource = source();
      await parcelSource.start([R1], [], sink);
      stub.latest(R1).callback(new Error('x'), []);
      await vi.advanceTimersByTimeAsync(0);
      stub.log.length = 0;
      await expect(parcelSource.renew(R1)).resolves.toEqual({ rebuilt: false });
      await expect(parcelSource.renew(R2)).resolves.toEqual({ rebuilt: false });
      expect(stub.log).toEqual([]);
    });

    it('rebuilds through a sentinel when the unsubscribe rejects (D165)', async () => {
      const parcelSource = source();
      await parcelSource.start([R1, R2], [], sink);
      stub.rejectUnsubscribe.add(R1);
      stub.log.length = 0;
      const result = await parcelSource.renew(R1);
      const sentinel = join(STATE, SENTINEL_DIR);
      expect(stub.log).toEqual([
        `unsubscribe ${R1}`,
        `unsubscribe ${R2}`,
        `subscribe ${sentinel}`,
        `unsubscribe ${sentinel}`,
        `subscribe ${R1}`,
        `subscribe ${R2}`,
      ]);
      expect(result).toMatchObject({ rebuilt: true, rebuildFailures: 0 });
      expect(sink.resubscribed).not.toHaveBeenCalled();
    });

    it('counts rejections inside the rebuild (D165, D176)', async () => {
      const parcelSource = source();
      await parcelSource.start([R1, R2], [], sink);
      stub.rejectUnsubscribe.add(R1);
      stub.rejectUnsubscribe.add(R2);
      stub.rejectUnsubscribe.add(join(STATE, SENTINEL_DIR));
      const result = await parcelSource.renew(R1);
      expect(result).toMatchObject({ rebuilt: true, rebuildFailures: 2 });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ sentinel: join(STATE, SENTINEL_DIR) }),
        expect.any(String),
      );
    });

    it('a renewal whose subscribe fails takes the error path (D131)', async () => {
      const parcelSource = source();
      await parcelSource.start([R1], [], sink);
      stub.failNext.push(new Error('Error starting watcher'));
      await expect(parcelSource.renew(R1)).resolves.toMatchObject({
        rebuilt: false,
      });
      await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
      expect(sink.resubscribed).toHaveBeenCalledWith(R1);
    });
  });
});
