/**
 * @module watcher/FileSystemWatcher.git.test
 * Each root's `.git` never produces events (D152), even with `watch.ignored` lacking `**\/.git/**`: a real repository at the watch root, committed to while watched.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';

let harness: WatcherHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Run git in `cwd` with a fixed identity. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, stdio: 'ignore' },
  );
}

describe("FileSystemWatcher and the root's .git (D152)", () => {
  it('reports no event under the root .git, initial or live', async () => {
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      before: (root) => {
        git(root, 'init', '-q');
        git(root, 'add', '-A');
        git(root, 'commit', '-q', '-m', 'one');
      },
    });
    const root = harness.root;
    await harness.write('b.md', 'b');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'two');
    await waitFor(() => harness!.seen().includes('create:b.md'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(harness.seen().filter((s) => s.includes('.git/'))).toEqual([]);
    expect(harness.seen()).toEqual(['create:a.md', 'create:b.md']);
  });

  it('drops a reported event under the root .git before any filter', async () => {
    harness = await startWatcherHarness();
    harness.watcher.event('add', join(harness.root, '.git', 'HEAD'));
    harness.watcher.event('change', join(harness.root, '.git', 'index'));
    harness.watcher.event('unlink', join(harness.root, '.git', 'ORIG_HEAD'));
    harness.watcher.event('add', join(harness.root, 'x.gitkeep'));
    expect(harness.seen()).toEqual(['create:x.gitkeep']);
  });
});
