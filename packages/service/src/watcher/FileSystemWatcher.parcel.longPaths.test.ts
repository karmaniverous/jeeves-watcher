/**
 * @module watcher/FileSystemWatcher.parcel.longPaths.test
 * Windows long paths under the real `@parcel/watcher` (D153, D199): parcel reports no `create` for a file whose path is 280 characters, at either `LongPathsEnabled` setting, so the file reaches the index only through the next periodic reconcile. The test does not depend on the runner's setting; the setting is read only to show it in the test title. Reads the registry; writes temp files.
 */

import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  eventsOf as of,
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

const windows = process.platform === 'win32';

/** The path length the spec names (D153). */
const LONG_PATH = 280;

/**
 * `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled`, for
 * the test title only.
 *
 * @returns `'1'`, `'0'` (an absent value is 0), or `'unreadable'`.
 */
function longPathsSetting(): string {
  try {
    const out = execFileSync(
      'reg',
      [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem',
        '/v',
        'LongPathsEnabled',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    return /LongPathsEnabled\s+REG_DWORD\s+0x0*1\b/.test(out) ? '1' : '0';
  } catch {
    return 'unreadable';
  }
}

/**
 * A directory under `root` deep enough that `<dir>/<file>` is exactly
 * {@link LONG_PATH} characters long.
 *
 * @param root - The watch root.
 * @param file - The file name.
 * @returns The directory, relative to the root, with `/` separators.
 */
function deepDir(root: string, file: string): string {
  const segments: string[] = [];
  const length = () => join(root, ...segments, file).length;
  while (length() < LONG_PATH - 40) segments.push('d'.repeat(30));
  const last = LONG_PATH - length() - 1;
  segments.push('e'.repeat(last));
  return segments.join('/');
}

const setting = windows ? longPathsSetting() : 'n/a';

describe.runIf(windows)(
  `FileSystemWatcher (parcel), Windows long paths (D153, D199); runner: LongPathsEnabled ${setting}`,
  () => {
    let harness: WatcherHarness | undefined;

    afterEach(async () => {
      await harness?.close();
      harness = undefined;
    });

    it('a 280-character path gets no live event and is indexed by the next periodic reconcile', async () => {
      const file = 'long.md';
      let dir = '';
      const changeSourceHealth = new ChangeSourceHealthTracker();
      const intervalMs = 4_000;
      harness = await startWatcherHarness({
        before: async (root) => {
          dir = deepDir(root, file);
          await mkdir(join(root, dir), { recursive: true });
        },
        watch: () => ({ changeSource: 'parcel' }),
        options: () => ({
          changeSourceHealth,
          getReconcileIntervalMs: () => intervalMs,
        }),
      });
      const h = harness;
      const path = await h.write(`${dir}/${file}`, 'long');
      expect(path).toHaveLength(LONG_PATH);
      // Well past the stability window, before the first periodic run.
      await sleep(1_500);
      expect(of(h, 'create')).toEqual([]);
      await waitFor(
        () => of(h, 'create').includes(`${dir}/${file}`),
        intervalMs + 10_000,
      );
      expect(changeSourceHealth.snapshot().reconcileEvents).toBeGreaterThan(0);
    }, 30_000);
  },
);
