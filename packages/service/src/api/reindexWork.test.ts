/**
 * @module api/reindexWork.test
 * reindexConcurrency falls back to the core default; processEach runs every item with bounded concurrency, logs and collects failures without stopping, and reports progress after every item (success or failure).
 */

import { REINDEX_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { processEach, reindexConcurrency } from './reindexWork';

describe('reindexConcurrency', () => {
  it('uses reindex.concurrency, else the core default', () => {
    const config = (reindex?: object) =>
      ({ reindex }) as unknown as JeevesWatcherConfig;
    expect(reindexConcurrency(config({ concurrency: 7 }))).toBe(7);
    expect(reindexConcurrency(config())).toBe(REINDEX_DEFAULTS.concurrency);
  });
});

describe('processEach', () => {
  it('runs every item, collects failures and reports progress for each', async () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as pino.Logger;
    const onProcessed = vi.fn();
    const work = vi.fn((item: string) =>
      item.startsWith('bad')
        ? Promise.reject(new Error(`no ${item}`))
        : Promise.resolve(),
    );

    const outcome = await processEach(['a', 'bad1', 'b', 'bad2'], work, {
      concurrency: 2,
      logger,
      onProcessed,
    });

    expect(outcome.processed).toBe(2);
    expect(outcome.failed.sort()).toEqual(['bad1', 'bad2']);
    expect(work).toHaveBeenCalledTimes(4);
    expect(onProcessed).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(
      warn.mock.calls
        .map(([obj]) => (obj as { filePath: string }).filePath)
        .sort(),
    ).toEqual(['bad1', 'bad2']);
  });

  it('never runs more than `concurrency` items at once', async () => {
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    await processEach(['1', '2', '3', '4', '5'], work, {
      concurrency: 2,
      logger: { warn: vi.fn() } as unknown as pino.Logger,
    });
    expect(peak).toBe(2);
  });
});
