/**
 * @module test/parcelPipelineHarness
 * A `ParcelPipeline` over a fake disk whose handler calls are recorded, for the pipeline tests.
 */

import { vi } from 'vitest';

import type { PathState } from '../watcher/batch/classifyBatch';
import {
  ParcelPipeline,
  type ParcelPipelineDeps,
} from '../watcher/batch/ParcelPipeline';
import type { RawChangeEvent } from '../watcher/changeSource/types';
import type { FilteredEvents } from '../watcher/filteredEvents';
import { Inventory } from '../watcher/inventory/Inventory';
import type { WatchFilter } from '../watcher/pathFilter';
import { WatchRoots } from '../watcher/roots';
import type { StabilityTicker } from '../watcher/stability/StabilityTicker';
import type { WalkedFile } from '../watcher/walk/Walker';

export const ROOT = '/r';

/** A pipeline over a fake disk; handler calls are recorded. */
export function setup(
  disk: Record<string, PathState> = {},
  overrides: Partial<ParcelPipelineDeps> = {},
) {
  const calls: string[] = [];
  const inventory = new Inventory(true);
  const filter = {
    globMatches: (path: string) => path.endsWith('.md'),
    isGitignored: () => false,
    isRootGit: () => false,
  } as unknown as WatchFilter;
  const events = {
    unlink: (path: string) => {
      inventory.delete(path);
      calls.push(`unlink ${path}`);
    },
    moved: (from: string, to: string) => {
      inventory.delete(from);
      inventory.set(to, { size: 1, mtimeMs: 1 });
      calls.push(`move ${from} -> ${to}`);
    },
  } as unknown as FilteredEvents;
  const ticker = {
    enter: (_key: string, path: string, synthetic: boolean) =>
      calls.push(`stability ${path}${synthetic ? ' synthetic' : ''}`),
    dropUnder: (dir: string) => calls.push(`drop ${dir}`),
  } as unknown as StabilityTicker;
  const walked = new Map<string, Map<string, WalkedFile>>();
  const pipeline = new ParcelPipeline({
    roots: new WatchRoots([ROOT]),
    filter,
    ignore: [(path) => path.includes('/node_modules')],
    inventory,
    events,
    ticker,
    reconcile: (dir) => calls.push(`reconcile ${dir}`),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as never,
    platform: 'linux',
    lstat: (path) =>
      Promise.resolve({ [ROOT]: 'dir' as const, ...disk }[path] ?? 'absent'),
    walk: (dir) => Promise.resolve(walked.get(dir) ?? new Map()),
    rootSettleMs: 0,
    ...overrides,
  });
  return { pipeline, calls, inventory, walked };
}

export const ev = (
  type: RawChangeEvent['type'],
  path: string,
): RawChangeEvent => ({
  type,
  path,
});
