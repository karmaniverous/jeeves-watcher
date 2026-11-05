/**
 * @module watcher/inventory/rebuildUnder.test
 * The `.gitignore` rebuild (D99) on a temp directory: now-filtered entries dropped, now-passing files added, and a failed walk logged without rejecting.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatchFilter } from '../pathFilter';
import { WatchRoots } from '../roots';
import type * as StatFile from '../walk/statFile';
import { isGone } from '../walk/statFile';
import { Inventory } from './Inventory';
import { rebuildAfterGitignore } from './rebuildUnder';

vi.mock('../walk/statFile', async (importOriginal) => {
  const actual = await importOriginal<typeof StatFile>();
  return { ...actual, isGone: vi.fn(actual.isGone) };
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-rebuild-'));
  await writeFile(join(dir, 'keep.md'), 'k');
  await writeFile(join(dir, 'new.md'), 'n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A logger recording info and warn messages. */
function recordingLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  return {
    logger: { info, warn, debug: vi.fn() } as unknown as pino.Logger,
    info,
    warn,
  };
}

/** A filter treating `ignored` names as gitignored. */
function filterFor(ignored: string[], logger: pino.Logger): WatchFilter {
  const gitignore = {
    isIgnored: (path: string) => ignored.some((name) => path.endsWith(name)),
  };
  return new WatchFilter(
    () => true,
    new WatchRoots([dir]),
    logger,
    gitignore as never,
  );
}

describe('rebuildAfterGitignore', () => {
  it('drops now-ignored entries and adds now-passing files', async () => {
    const { logger, info } = recordingLogger();
    const inventory = new Inventory(false);
    inventory.set(join(dir, 'keep.md'));
    inventory.set(join(dir, 'hide.md'));
    await rebuildAfterGitignore(
      { inventory, filter: filterFor(['hide.md'], logger), ignore: [] },
      dir,
      logger,
    );
    expect(
      [...inventory.entriesUnder(dir).values()].map((e) => e.path).sort(),
    ).toEqual([join(dir, 'keep.md'), join(dir, 'new.md')].sort());
    expect(info).toHaveBeenCalledWith(
      { dir, dropped: 1, added: 1 },
      'Inventory rebuilt after .gitignore change',
    );
  });

  it('does not add back a file unlinked while the walk ran', async () => {
    const { logger } = recordingLogger();
    const inventory = new Inventory(false);
    inventory.set(join(dir, 'keep.md'));
    // new.md was walked, then unlinked before the rebuild applied it.
    vi.mocked(isGone).mockImplementation((path) =>
      Promise.resolve(path.endsWith('new.md')),
    );
    await rebuildAfterGitignore(
      { inventory, filter: filterFor([], logger), ignore: [] },
      dir,
      logger,
    );
    expect(inventory.get(join(dir, 'new.md'))).toBeUndefined();
    expect(inventory.size).toBe(1);
  });

  it('logs a failed walk and leaves the inventory alone', async () => {
    const { logger, warn } = recordingLogger();
    const inventory = new Inventory(false);
    inventory.set(join(dir, 'keep.md'));
    await rebuildAfterGitignore(
      { inventory, filter: filterFor([], logger), ignore: [] },
      join(dir, 'missing'),
      logger,
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(inventory.size).toBe(1);
  });
});
