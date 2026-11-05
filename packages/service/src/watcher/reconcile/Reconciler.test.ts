/**
 * @module watcher/reconcile/Reconciler.test
 * `reconcile(dir)` on a temp directory against a real inventory (D90, D179): nothing for an unchanged root, synthetic adds to the stability wait, stat-confirmed unlinks, the guards, triggers before the initial scan, and the merged rerun.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeDocumentKey } from '../../util/documentKey';
import { ChangeSourceHealthTracker } from '../ChangeSourceHealthTracker';
import { Inventory } from '../inventory/Inventory';
import { WatchRoots } from '../roots';
import { isGone } from '../walk/statFile';
import { Reconciler, type ReconcilerDeps } from './Reconciler';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-reconcile-'));
  await mkdir(join(root, 'a', 'b'), { recursive: true });
  await writeFile(join(root, 'one.md'), '1');
  await writeFile(join(root, 'a', 'two.md'), '22');
  await writeFile(join(root, 'a', 'b', 'three.md'), '333');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A reconciler on `root` with recording callbacks. */
function setup(overrides: Partial<ReconcilerDeps> = {}) {
  const inventory = new Inventory(overrides.compareStats ?? false);
  const entered: string[] = [];
  const unlinked: string[] = [];
  const completed: string[] = [];
  const health = new ChangeSourceHealthTracker();
  const logger = {
    debug: vi.fn((fields: { dir?: string }, message: string) => {
      if (message === 'Reconcile complete' && fields.dir) {
        completed.push(fields.dir);
      }
    }),
    warn: vi.fn(),
  } as unknown as pino.Logger;
  const reconciler = new Reconciler({
    roots: new WatchRoots([root]),
    inventory,
    walkOptions: () => ({ prune: () => false, include: () => true }),
    scanned: () => true,
    unavailable: () => false,
    enterStability: (_key, path) => entered.push(path),
    unlink: (path) => {
      unlinked.push(path);
      inventory.delete(path);
    },
    isGone,
    compareStats: false,
    logger,
    health,
    ...overrides,
  });
  const fill = () => {
    for (const p of ['one.md', 'a/two.md', 'a/b/three.md']) {
      inventory.set(join(root, p));
    }
  };
  return { reconciler, inventory, entered, unlinked, completed, health, fill };
}

describe('Reconciler', () => {
  it('emits nothing when the root matches the inventory, and records timing', async () => {
    const s = setup();
    s.fill();
    await s.reconciler.reconcile(root);
    await s.reconciler.reconcile(root);
    expect(s.entered).toEqual([]);
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot()).toMatchObject({
      reconcileEvents: 0,
      reconcileErrors: 0,
    });
    expect(s.health.snapshot().lastReconcileDurationMs).toBeTypeOf('number');
    expect(s.health.snapshot().lastReconcileAt).not.toBeNull();
  });

  it('sends a file the inventory lacks to the stability wait', async () => {
    const s = setup();
    s.fill();
    await writeFile(join(root, 'a', 'missed.md'), 'm');
    await s.reconciler.reconcile(join(root, 'a'));
    expect(s.entered).toEqual([join(root, 'a', 'missed.md')]);
  });

  it('unlinks an inventory file lstat confirms gone, and counts it', async () => {
    const s = setup();
    s.fill();
    s.inventory.set(join(root, 'a', 'ghost.md'));
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([join(root, 'a', 'ghost.md')]);
    expect(s.health.snapshot().reconcileEvents).toBe(1);
  });

  it('leaves a filtered-but-present file and an unconfirmed absence alone', async () => {
    const s = setup({
      walkOptions: () => ({
        prune: () => false,
        include: (p) => !p.endsWith('two.md'),
      }),
      isGone: (p) =>
        p.endsWith('locked.md') ? Promise.resolve(false) : isGone(p),
    });
    s.fill();
    s.inventory.set(join(root, 'locked.md'));
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([]);
    expect(s.entered).toEqual([]);
  });

  it('does not unlink an entry a real event removed during the check', async () => {
    const ghost = join(root, 'ghost.md');
    const s = setup({
      isGone: (p) => {
        if (p === ghost) s.inventory.delete(ghost);
        return isGone(p);
      },
    });
    s.fill();
    s.inventory.set(ghost);
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([]);
  });

  it('compares size and mtime only when the inventory tracks stats', async () => {
    const tracked = setup({ compareStats: true });
    tracked.inventory.set(join(root, 'one.md'), { size: 99, mtimeMs: 1 });
    await tracked.reconciler.reconcile(root);
    expect(tracked.entered).toContain(join(root, 'one.md'));
    const untracked = setup();
    untracked.fill();
    await untracked.reconciler.reconcile(root);
    expect(untracked.entered).toEqual([]);
  });

  it('emits nothing and counts an error when the root walk fails', async () => {
    const s = setup();
    s.fill();
    await rm(root, { recursive: true, force: true });
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot().reconcileErrors).toBe(1);
  });

  it('emits nothing and counts an error when a subdirectory is gone before its reconcile (Design 9 guard)', async () => {
    const s = setup();
    s.fill();
    await rm(join(root, 'a'), { recursive: true });
    await s.reconciler.reconcile(join(root, 'a', 'b'));
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot().reconcileErrors).toBe(1);
  });

  it('emits nothing once stopped, even for a reconcile already walking', async () => {
    const s = setup({
      walkOptions: () => ({
        prune: () => false,
        include: () => {
          s.reconciler.stop();
          return true;
        },
      }),
    });
    s.inventory.set(join(root, 'gone.md'));
    await s.reconciler.reconcile(root);
    await s.reconciler.reconcile(root);
    expect(s.entered).toEqual([]);
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot().lastReconcileAt).toBeNull();
  });

  it('treats an empty root walk against a non-empty inventory as an error (unmounted root)', async () => {
    const s = setup({
      walkOptions: () => ({ prune: () => true, include: () => false }),
    });
    s.fill();
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot().reconcileErrors).toBe(1);
  });

  it('skips an unavailable root without unlinking', async () => {
    const s = setup({ unavailable: () => true });
    s.fill();
    s.inventory.set(join(root, 'ghost.md'));
    await s.reconciler.reconcile(root);
    expect(s.unlinked).toEqual([]);
    expect(s.health.snapshot().reconcileErrors).toBe(1);
  });

  it('drops triggers before the initial scan and outside every root', async () => {
    const walkOptions = vi.fn(() => ({
      prune: () => false,
      include: () => true,
    }));
    const s = setup({ scanned: () => false, walkOptions });
    await s.reconciler.reconcile(root);
    await s.reconciler.reconcile(join(tmpdir(), 'elsewhere'));
    expect(walkOptions).not.toHaveBeenCalled();
    expect(s.health.snapshot().lastReconcileAt).toBeNull();
  });

  it('merges triggers during a run into one rerun per covering directory (D179)', async () => {
    const latch: { open?: () => void } = {};
    const gate = new Promise<undefined>((resolve) => {
      latch.open = () => {
        resolve(undefined);
      };
    });
    const s = setup({
      isGone: async (p) => {
        await gate;
        return isGone(p);
      },
    });
    s.fill();
    s.inventory.set(join(root, 'ghost.md'));
    const first = s.reconciler.reconcile(root);
    await new Promise((resolve) => setTimeout(resolve, 50));
    void s.reconciler.reconcile(join(root, 'a', 'b'));
    void s.reconciler.reconcile(join(root, 'a'));
    void s.reconciler.reconcile(join(root, 'a', 'c'));
    latch.open?.();
    await first;
    expect(s.completed).toEqual([root, join(root, 'a')]);
    expect(normalizeDocumentKey(s.unlinked[0])).toBe(
      normalizeDocumentKey(join(root, 'ghost.md')),
    );
  });
});
