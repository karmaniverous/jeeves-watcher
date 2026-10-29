/**
 * @module api/registerConfigRoutes.test
 * POST /config/apply's auto-reindex callback (`createConfigApplyCallback`): runs `configWatch.reindex` (default `issues`) through executeReindex, file-only (`includeSources` unset) over the live config; the scope never comes from anywhere else.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { ApiServerOptions } from './apiServerOptions';
import { executeReindex } from './executeReindex';
import { createConfigApplyCallback } from './registerConfigRoutes';
import { ReindexTracker } from './ReindexTracker';

vi.mock('./executeReindex', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

const executeReindexMock = vi.mocked(executeReindex);

/** Build the apply callback over a config read live through `getConfig`. */
function callbackOver(getConfig: () => Partial<JeevesWatcherConfig>) {
  const options = {
    logger: pino({ level: 'silent' }),
    configPath: '/cfg/watcher.config.json',
    descriptor: {},
    processor: {},
    issuesManager: {},
    valuesManager: {},
    vectorStore: {},
    queue: {},
  } as unknown as ApiServerOptions;
  return createConfigApplyCallback(options, {
    getConfig: getConfig as () => JeevesWatcherConfig,
    reindexTracker: new ReindexTracker(),
  });
}

beforeEach(() => {
  executeReindexMock.mockClear();
});

describe('createConfigApplyCallback', () => {
  it.each([
    ['defaults to issues', {}, 'issues'],
    ['runs the configured scope', { configWatch: { reindex: 'full' } }, 'full'],
    [
      'runs rules when configured',
      { configWatch: { reindex: 'rules' } },
      'rules',
    ],
  ] as const)('%s, file-only', async (_label, config, scope) => {
    const onConfigApply = callbackOver(() => config);
    expect(executeReindexMock).not.toHaveBeenCalled();

    await onConfigApply();

    expect(executeReindexMock).toHaveBeenCalledTimes(1);
    const [deps, options] = executeReindexMock.mock.calls[0];
    expect(options).toEqual({ scope });
    expect(deps.includeSources).toBeUndefined();
    expect(deps.config).toBe(config);
  });

  it('reads the scope from the config at apply time, not at build time', async () => {
    let config: Partial<JeevesWatcherConfig> = {};
    const onConfigApply = callbackOver(() => config);
    config = { configWatch: { reindex: 'full' } } as never;

    await onConfigApply();

    expect(executeReindexMock.mock.calls[0][1]).toEqual({ scope: 'full' });
  });
});
