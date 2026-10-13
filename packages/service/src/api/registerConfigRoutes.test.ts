/**
 * @module api/registerConfigRoutes.test
 * POST /config/apply's auto-reindex: runs `configWatch.reindex` (default `issues`) through executeReindex, file-only (`includeSources` unset) over the live config; the scope never comes from anywhere else.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { ApiServerOptions } from './apiServerOptions';
import { executeReindex } from './executeReindex';
import { createConfigApplyRouteHandler } from './handlers/configApply';
import { registerConfigRoutes } from './registerConfigRoutes';
import { ReindexTracker } from './ReindexTracker';

vi.mock('./executeReindex', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./handlers/configApply', () => ({
  createConfigApplyRouteHandler: vi.fn(() => vi.fn()),
}));

const executeReindexMock = vi.mocked(executeReindex);
const configApplyMock = vi.mocked(createConfigApplyRouteHandler);

/** Register the routes over `config`; return the captured onConfigApply. */
function register(config: Partial<JeevesWatcherConfig>) {
  const app = { get: vi.fn(), post: vi.fn() };
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
  registerConfigRoutes(app as never, options, {
    getConfig: () => config as JeevesWatcherConfig,
    reindexTracker: new ReindexTracker(),
    cacheTtlMs: 0,
  });
  const deps = configApplyMock.mock.calls[0][0];
  return deps.onConfigApply;
}

beforeEach(() => {
  executeReindexMock.mockClear();
  configApplyMock.mockClear();
});

describe('registerConfigRoutes config-apply reindex', () => {
  it.each([
    ['defaults to issues', {}, 'issues'],
    ['runs the configured scope', { configWatch: { reindex: 'full' } }, 'full'],
    [
      'runs rules when configured',
      { configWatch: { reindex: 'rules' } },
      'rules',
    ],
  ] as const)('%s, file-only', async (_label, config, scope) => {
    const onConfigApply = register(config);
    expect(executeReindexMock).not.toHaveBeenCalled();

    await onConfigApply({});

    expect(executeReindexMock).toHaveBeenCalledTimes(1);
    const [deps, options] = executeReindexMock.mock.calls[0];
    expect(options).toEqual({ scope });
    expect(deps.includeSources).toBeUndefined();
    expect(deps.config).toBe(config);
  });
});
