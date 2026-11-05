/**
 * @module watcher/sourceWiring.test
 * Source wiring: parcel when loaded, else chokidar (D125); a renewal's duration and its rebuild rejections reach `health.changeSource` (D157, D165, D176); the Linux warning when renewal is off with the periodic reconcile (D129).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { ChangeSource, RenewResult } from './changeSource/types';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';
import { createSource, renewRecorded, warnRenewalOff } from './sourceWiring';

const silent = pino({ level: 'silent' });
const watch = { paths: ['/r/**'], ignored: [] };

/** A source whose renew resolves `result`. */
function renewing(result: RenewResult): ChangeSource {
  return {
    renew: vi.fn(() => Promise.resolve(result)),
  } as unknown as ChangeSource;
}

describe('createSource', () => {
  it('builds parcel when the module is loaded, else chokidar', () => {
    const parcel = createSource({
      config: watch,
      parcel: { subscribe: vi.fn() },
      logger: silent,
      onSourceError: vi.fn(),
    });
    expect(parcel).toMatchObject({ name: 'parcel', initialSet: 'walk' });
    const chokidar = createSource({
      config: watch,
      logger: silent,
      onSourceError: vi.fn(),
    });
    expect(chokidar.name).toBe('chokidar');
  });
});

describe('renewRecorded', () => {
  it('records the duration and rebuild rejections', async () => {
    const health = new ChangeSourceHealthTracker();
    const result = await renewRecorded(
      renewing({ rebuilt: true, durationMs: 42, rebuildFailures: 2 }),
      '/r',
      health,
    );
    expect(result.rebuilt).toBe(true);
    expect(health.snapshot()).toMatchObject({
      lastRenewDurationMs: 42,
      renewFailures: 2,
    });
  });

  it('records nothing when no renewal ran (Windows, chokidar: D177)', async () => {
    const health = new ChangeSourceHealthTracker();
    await renewRecorded(renewing({ rebuilt: false }), '/r', health);
    await renewRecorded(
      renewing({ rebuilt: false, durationMs: 3, rebuildFailures: 0 }),
      '/r',
      undefined,
    );
    expect(health.snapshot()).toMatchObject({
      lastRenewDurationMs: null,
      renewFailures: 0,
    });
  });
});

describe('warnRenewalOff', () => {
  it.each([
    ['parcel', 0, 'linux', true],
    ['parcel', 1000, 'linux', false],
    ['parcel', 0, 'win32', false],
    ['chokidar', 0, 'linux', false],
  ] as const)(
    '%s, interval %d, %s -> %s',
    (name, interval, platform, warned) => {
      const warn = vi.fn();
      expect(
        warnRenewalOff({ name }, interval, { warn } as never, platform),
      ).toBe(warned);
      expect(warn).toHaveBeenCalledTimes(warned ? 1 : 0);
    },
  );

  it('defaults to the running platform', () => {
    const warn = vi.fn();
    warnRenewalOff({ name: 'parcel' }, 0, { warn } as never);
    expect(warn).toHaveBeenCalledTimes(process.platform === 'linux' ? 1 : 0);
  });
});
