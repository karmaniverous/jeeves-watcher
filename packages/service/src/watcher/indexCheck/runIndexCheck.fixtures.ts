/**
 * @module watcher/indexCheck/runIndexCheck.fixtures
 * Test fixtures for the index check: a fake paged index, a fake view over an inventory set, and deps that record the delete-event calls. Pure apart from `vi.fn`.
 */

import pino from 'pino';
import { vi } from 'vitest';

import { IndexCheckHealthTracker } from './IndexCheckHealthTracker';
import type { IndexCheckDeps } from './runIndexCheck';
import type { IndexCheckSkipReason, IndexCheckView } from './view';

export type Payload = Record<string, unknown>;

/** A fake index answering pages of `size` from `payloads`. */
export function fakeStore(payloads: Payload[], size = 1000) {
  return {
    scrollPage: vi.fn(
      (
        _filter: Record<string, unknown> | undefined,
        limit: number | undefined,
        offset?: string | number,
      ) => {
        const pageSize = limit ?? size;
        const start = typeof offset === 'number' ? offset : 0;
        const points = payloads
          .slice(start, start + pageSize)
          .map((payload, i) => ({ id: String(start + i), payload }));
        const next = start + pageSize;
        return Promise.resolve({
          points,
          nextCursor: next < payloads.length ? next : undefined,
        });
      },
    ),
  };
}

export interface Setup {
  roots?: string[];
  inventory?: string[];
  gone?: string[];
  goneRoots?: string[];
  skip?: Record<string, IndexCheckSkipReason>;
  payloads: Payload[];
  pageSize?: number;
  live?: () => boolean;
  stopped?: () => boolean;
}

export function setup(s: Setup) {
  const inventory = new Set(s.inventory ?? []);
  const gone = new Set(s.gone ?? []);
  const calls: string[] = [];
  const view: IndexCheckView = {
    roots: s.roots ?? ['/r'],
    skipReason: (root) => s.skip?.[root],
    has: (path) => inventory.has(path),
    live: s.live ?? (() => true),
  };
  const health = new IndexCheckHealthTracker();
  const store = fakeStore(s.payloads);
  const deps: IndexCheckDeps = {
    view,
    vectorStore: store,
    deleteFile: vi.fn((path: string) => {
      calls.push(`delete ${path}`);
      return Promise.resolve();
    }),
    onVcsFileChange: vi.fn((path: string, event: string) => {
      calls.push(`vcs ${event} ${path}`);
    }),
    health,
    logger: pino({ level: 'silent' }),
    stopped: s.stopped,
    isGone: (path) => Promise.resolve(gone.has(path)),
    rootGone: (root) => Promise.resolve((s.goneRoots ?? []).includes(root)),
    platform: 'linux',
    pageSize: s.pageSize,
  };
  return { deps, calls, health, store, inventory };
}

export const file = (path: string): Payload => ({ file_path: path });

/** Kept documents per root, so one candidate stays within the 10% share even without its floor. */
export const PAD = 9;

/** `PAD` documents under `root` the inventory holds. */
export function kept(root: string): { paths: string[]; payloads: Payload[] } {
  const paths = Array.from(
    { length: PAD },
    (_, i) => `${root}/kept${String(i)}.md`,
  );
  return { paths, payloads: paths.map(file) };
}
