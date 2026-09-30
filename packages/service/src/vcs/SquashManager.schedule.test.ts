/**
 * @module vcs/SquashManager.schedule.test
 * The squash scheduler: checks the cron expression once a minute, runs a
 * squash only on a match, is idempotent on start, and stops cleanly.
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRetention } from '../test/squashRepo';
import { SquashManager } from './SquashManager';

const silentLogger = pino({ level: 'silent' });

function scheduled(squashCron: string) {
  const manager = new SquashManager(
    '/not/used',
    makeRetention({ squashCron }),
    silentLogger,
  );
  const runSquash = vi
    .spyOn(manager, 'runSquash')
    .mockResolvedValue({ squashed: false });
  return { manager, runSquash };
}

describe('SquashManager scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 30)); // 00:00:30
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a squash on each minute tick whose time matches the cron', () => {
    const { manager, runSquash } = scheduled('* * * * *');
    manager.start();

    vi.advanceTimersByTime(60_000);
    expect(runSquash).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(runSquash).toHaveBeenCalledTimes(2);

    manager.stop();
  });

  it('does not run when the cron does not match', () => {
    const { manager, runSquash } = scheduled('0 3 * * *'); // 03:00 only
    manager.start();

    vi.advanceTimersByTime(10 * 60_000);
    expect(runSquash).not.toHaveBeenCalled();

    manager.stop();
  });

  it('ignores a second start and schedules nothing after stop', () => {
    const { manager, runSquash } = scheduled('* * * * *');
    manager.start();
    manager.start();

    vi.advanceTimersByTime(60_000);
    expect(runSquash).toHaveBeenCalledTimes(1);

    manager.stop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(runSquash).toHaveBeenCalledTimes(1);
  });
});
