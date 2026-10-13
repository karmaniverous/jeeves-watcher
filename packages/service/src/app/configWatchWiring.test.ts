/**
 * @module app/configWatchWiring.test
 * startConfigWatch: no watcher without a config path (logged at debug) or when `configWatch.enabled` is false.
 */

import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { startConfigWatch } from './configWatchWiring';

function logger() {
  return { debug: vi.fn() };
}

const config = (enabled?: boolean) =>
  ({ configWatch: { enabled } }) as unknown as JeevesWatcherConfig;

describe('startConfigWatch', () => {
  it('starts nothing without a config path and says so at debug', () => {
    const log = logger();
    const onChange = vi.fn();
    expect(
      startConfigWatch(config(true), undefined, log as never, onChange),
    ).toBeUndefined();
    expect(log.debug).toHaveBeenCalledOnce();
  });

  it('starts nothing when config watch is disabled', () => {
    const log = logger();
    expect(
      startConfigWatch(
        config(false),
        '/cfg/config.json',
        log as unknown as pino.Logger,
        vi.fn(),
      ),
    ).toBeUndefined();
    expect(log.debug).not.toHaveBeenCalled();
  });
});
