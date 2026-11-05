/**
 * @module watcher/changeSource/ParcelSource.real.test
 * The parcel source over the real `@parcel/watcher` on this platform (Windows and Linux CI): batches arrive for writes, the ignore list (with the root's `.git`, D152) keeps ignored paths out, and after stop nothing arrives. On Windows stop unsubscribes nothing (D196): the callback is silenced and the subscription ends with the test worker.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadParcelWatcher } from './parcelModule';
import { ParcelSource } from './ParcelSource';
import type { ChangeSink, RawChangeEvent } from './types';

const silent = pino({ level: 'silent' });

/** Wait until `check` passes or time out. */
async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('ParcelSource (real @parcel/watcher)', () => {
  let root: string;
  let state: string;
  let seen: RawChangeEvent[];
  let sink: ChangeSink;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'parcel-real-')));
    state = await mkdtemp(join(tmpdir(), 'parcel-real-state-'));
    await mkdir(join(root, 'skip'));
    await mkdir(join(root, '.git'));
    seen = [];
    sink = {
      event: vi.fn(),
      rawEvents: (_root, events) => {
        seen.push(...events);
      },
      initialScanDone: vi.fn(),
      resubscribed: vi.fn(),
      rootUnavailable: vi.fn(),
      rootAvailable: vi.fn(),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  it('delivers batches, honours the ignore list, and stops', async () => {
    const source = new ParcelSource({
      parcel: await loadParcelWatcher(),
      ignored: ['skip/**', join(root, 'skip')],
      stateDir: state,
      logger: silent,
    });
    await source.start([root], [], sink);
    await writeFile(join(root, 'skip', 'x.md'), 'x');
    await writeFile(join(root, '.git', 'HEAD'), 'x');
    await writeFile(join(root, 'a.md'), 'a');
    await until(() => seen.some((e) => e.path === join(root, 'a.md')));
    expect(seen.some((e) => e.path.includes(join(root, 'skip')))).toBe(false);
    expect(seen.some((e) => e.path.includes(join(root, '.git')))).toBe(false);
    await expect(source.renew(root)).resolves.toMatchObject({
      rebuilt: false,
    });
    await writeFile(join(root, 'b.md'), 'b');
    await until(() => seen.some((e) => e.path === join(root, 'b.md')));
    await source.stop();
    const count = seen.length;
    await writeFile(join(root, 'c.md'), 'c');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toHaveLength(count);
  });
});
