/**
 * @module app/startFromConfig.test
 * startFromConfig with config loading, the watcher and shutdown handlers mocked: load-time warnings reach the console (the logger does not exist yet), and the watcher is built from the loaded config and started.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config';
import { loadConfig } from '../config';
import { startFromConfig } from './startFromConfig';

const { start, constructed } = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  constructed: vi.fn(),
}));

vi.mock('../config', () => ({ loadConfig: vi.fn() }));
vi.mock('./shutdown', () => ({ installShutdownHandlers: vi.fn() }));
vi.mock('./index.js', () => ({
  JeevesWatcher: class {
    start = start;
    stop = vi.fn();
    constructor(...args: unknown[]) {
      constructed(...args);
    }
  },
}));

describe('startFromConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prints load warnings to the console, then builds and starts the watcher', async () => {
    const config = { watch: { paths: ['**'] } } as JeevesWatcherConfig;
    vi.mocked(loadConfig).mockImplementation((_path, options) => {
      options?.onWarning?.({
        path: 'sources.app.batchUrl',
        message: 'Unknown source key; ignored',
      });
      return Promise.resolve(config);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await startFromConfig('/cfg/jeeves-watcher.config.json');

    expect(loadConfig).toHaveBeenCalledWith(
      '/cfg/jeeves-watcher.config.json',
      expect.anything(),
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[jeeves-watcher] sources.app.batchUrl: Unknown source key; ignored',
    );
    expect(constructed).toHaveBeenCalledWith(
      config,
      '/cfg/jeeves-watcher.config.json',
      undefined,
    );
    expect(start).toHaveBeenCalledOnce();
  });
});
