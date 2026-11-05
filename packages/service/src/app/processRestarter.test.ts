/**
 * @module app/processRestarter.test
 * The app's exit for a restart (D196): logs the cause, writes the restart record, stops gracefully and then exits with the restart code (also after a failed stop), counts only the first request; the next start takes the record once and ignores an unreadable one. Temp state dirs.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test/parcelStub';
import { RESTART_EXIT_CODE } from '../watcher/changeSource/restart';
import {
  createProcessRestarter,
  RESTART_RECORD_FILE,
  resumeAfterRestart,
  takeRestartRecord,
} from './processRestarter';

const AT = new Date('2026-11-05T16:00:00.000Z');

describe('process restarter (D196)', () => {
  let stateDir: string;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'jeeves-watcher-restart-'));
    logger = createMockLogger();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  /** A restarter over the temp dir whose stop is `stop`. */
  function restarter(stop: () => Promise<void>, exit = vi.fn()) {
    return {
      exit,
      restarter: createProcessRestarter({
        stateDir,
        logger: () => logger as never,
        stop,
        exit,
        now: () => AT,
      }),
    };
  }

  it('logs, records, stops, then exits with the restart code; only once', async () => {
    const order: string[] = [];
    let finishStop: () => void = () => undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('stop');
          finishStop = resolve;
        }),
    );
    const { exit, restarter: r } = restarter(
      stop,
      vi.fn(() => order.push('exit')),
    );
    r.restart({ cause: 'watch-config-changed', reindex: 'rules' });
    r.restart({ cause: 'root-gone' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'watch-config-changed',
        exitCode: RESTART_EXIT_CODE,
      }),
      expect.stringContaining('D196'),
    );
    expect(
      JSON.parse(readFileSync(join(stateDir, RESTART_RECORD_FILE), 'utf8')),
    ).toEqual({
      cause: 'watch-config-changed',
      at: AT.toISOString(),
      reindex: 'rules',
    });
    expect(exit).not.toHaveBeenCalled();
    finishStop();
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(RESTART_EXIT_CODE);
    });
    expect(order).toEqual(['stop', 'exit']);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('exits after a failed stop, and logs it', async () => {
    const { exit, restarter: r } = restarter(() =>
      Promise.reject(new Error('stuck')),
    );
    r.restart({ cause: 'subscription-error' });
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'Graceful stop before the restart failed',
    );
  });

  it('still stops and exits when the record cannot be written', async () => {
    const file = join(stateDir, 'not-a-dir');
    writeFileSync(file, '');
    const exit = vi.fn();
    createProcessRestarter({
      stateDir: file,
      logger: () => logger as never,
      stop: () => Promise.resolve(),
      exit,
    }).restart({ cause: 'root-gone' });
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'Could not write the restart record',
    );
  });

  it('works before the logger exists', async () => {
    const exit = vi.fn();
    createProcessRestarter({
      stateDir,
      logger: () => undefined,
      stop: () => Promise.resolve(),
      exit,
    }).restart({ cause: 'root-gone' });
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    });
  });

  it('the next start takes the record once', async () => {
    const { exit, restarter: r } = restarter(() => Promise.resolve());
    r.restart({ cause: 'root-gone', root: '/r' });
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });
    expect(takeRestartRecord(stateDir, logger as never)).toEqual({
      cause: 'root-gone',
      at: AT.toISOString(),
    });
    expect(existsSync(join(stateDir, RESTART_RECORD_FILE))).toBe(false);
    expect(takeRestartRecord(stateDir, logger as never)).toBeUndefined();
  });

  it('a start resumes from the record: health, log, record returned', () => {
    const record = {
      cause: 'root-gone',
      at: AT.toISOString(),
      reindex: 'issues',
    };
    writeFileSync(join(stateDir, RESTART_RECORD_FILE), JSON.stringify(record));
    const health = { recordRestart: vi.fn() };
    expect(resumeAfterRestart(stateDir, logger as never, health)).toEqual(
      record,
    );
    expect(health.recordRestart).toHaveBeenCalledExactlyOnceWith(record);
    expect(logger.info).toHaveBeenCalledWith(
      record,
      'Started after an exit for a restart (D196)',
    );
    expect(
      resumeAfterRestart(stateDir, logger as never, health),
    ).toBeUndefined();
    expect(health.recordRestart).toHaveBeenCalledOnce();
  });

  it('ignores and removes an unreadable record', () => {
    const path = join(stateDir, RESTART_RECORD_FILE);
    writeFileSync(path, '{"cause":"crash"}');
    expect(takeRestartRecord(stateDir, logger as never)).toBeUndefined();
    expect(existsSync(path)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'Ignored an unreadable restart record',
    );
  });
});
