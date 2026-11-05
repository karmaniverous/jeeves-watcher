/**
 * @module app/processRestarter.test
 * The app's exit for a restart (D196): logs the cause, writes the restart record, stops gracefully and then exits with the restart code (also after a failed stop, and at the deadline when the stop hangs), exits once, and lets a later request add a deferred reindex; the next start reads the record, reports it, and clears it only after the start succeeded (never a newer record); an unreadable record is ignored. Temp state dirs.
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

import { executeReindex } from '../api/executeReindex';
import { createMockLogger } from '../test/parcelStub';
import { RESTART_EXIT_CODE } from '../watcher/changeSource/restart';
import {
  clearRestartRecord,
  completeRestart,
  createProcessRestarter,
  readRestartRecord,
  RESTART_RECORD_FILE,
  resumeAfterRestart,
} from './processRestarter';

vi.mock('../api/executeReindex', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

const AT = new Date('2026-11-05T16:00:00.000Z');

describe('process restarter (D196)', () => {
  let stateDir: string;
  let logger: ReturnType<typeof createMockLogger>;
  const recordPath = () => join(stateDir, RESTART_RECORD_FILE);
  const onDisk = () =>
    JSON.parse(readFileSync(recordPath(), 'utf8')) as unknown;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'jeeves-watcher-restart-'));
    logger = createMockLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
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
        deadlineMs: 1_000,
        exit,
        now: () => AT,
      }),
    };
  }

  it('logs, records, stops, then exits with the restart code; exits once', async () => {
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
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cause: 'watch-config-changed',
        exitCode: RESTART_EXIT_CODE,
      }),
      expect.stringContaining('D196'),
    );
    expect(onDisk()).toEqual({
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

  it('a later request adds its deferred reindex to the record, never replacing one', () => {
    const { restarter: r } = restarter(() => new Promise(() => undefined));
    r.restart({ cause: 'subscription-error' });
    expect(onDisk()).toEqual({
      cause: 'subscription-error',
      at: AT.toISOString(),
    });
    r.restart({ cause: 'watch-config-changed', reindex: 'full' });
    r.restart({ cause: 'watch-config-changed', reindex: 'issues' });
    expect(onDisk()).toEqual({
      cause: 'subscription-error',
      at: AT.toISOString(),
      reindex: 'full',
    });
  });

  it('exits at the deadline when the graceful stop hangs, and only once', async () => {
    vi.useFakeTimers();
    let finishStop: () => void = () => undefined;
    const { exit, restarter: r } = restarter(
      () => new Promise<void>((resolve) => (finishStop = resolve)),
    );
    r.restart({ cause: 'root-gone' });
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(RESTART_EXIT_CODE);
    expect(logger.error).toHaveBeenCalledWith(
      { deadlineMs: 1_000 },
      expect.stringContaining('did not finish in time'),
    );
    finishStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledOnce();
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

  it('still stops and exits when the record cannot be written, and before the logger exists', async () => {
    const file = join(stateDir, 'not-a-dir');
    writeFileSync(file, '');
    const exit = vi.fn();
    createProcessRestarter({
      stateDir: file,
      logger: () => logger as never,
      stop: () => Promise.resolve(),
      deadlineMs: 1_000,
      exit,
    }).restart({ cause: 'root-gone' });
    const early = vi.fn();
    createProcessRestarter({
      stateDir,
      logger: () => undefined,
      stop: () => Promise.resolve(),
      deadlineMs: 1_000,
      exit: early,
    }).restart({ cause: 'root-gone' });
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
      expect(early).toHaveBeenCalledWith(RESTART_EXIT_CODE);
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'Could not write the restart record',
    );
  });

  it('a start resumes from the record and keeps it until the start succeeded', () => {
    const record = {
      cause: 'root-gone',
      at: AT.toISOString(),
      reindex: 'issues',
    };
    writeFileSync(recordPath(), JSON.stringify(record));
    const health = { recordRestart: vi.fn() };
    expect(resumeAfterRestart(stateDir, logger as never, health)).toEqual(
      record,
    );
    expect(health.recordRestart).toHaveBeenCalledExactlyOnceWith(record);
    expect(logger.info).toHaveBeenCalledWith(
      record,
      'Started after an exit for a restart (D196)',
    );
    // A refused start leaves it for the next one.
    expect(existsSync(recordPath())).toBe(true);
    expect(resumeAfterRestart(stateDir, logger as never, health)).toEqual(
      record,
    );
  });

  it('clears only the record the start read, never a newer one', () => {
    const old = { cause: 'root-gone' as const, at: AT.toISOString() };
    const newer = {
      cause: 'subscription-error',
      at: '2026-11-05T17:00:00.000Z',
    };
    writeFileSync(recordPath(), JSON.stringify(newer));
    clearRestartRecord(stateDir, old);
    expect(onDisk()).toEqual(newer);
    writeFileSync(recordPath(), JSON.stringify(old));
    clearRestartRecord(stateDir, old);
    expect(existsSync(recordPath())).toBe(false);
    expect(() => {
      clearRestartRecord(stateDir, old);
    }).not.toThrow();
    expect(readRestartRecord(stateDir, logger as never)).toBeUndefined();
  });

  it('completing a restart clears the record and runs the deferred reindex, logging a failure', async () => {
    const record = {
      cause: 'watch-config-changed' as const,
      at: AT.toISOString(),
    };
    writeFileSync(recordPath(), JSON.stringify(record));
    const deps = {
      getConfig: () => ({}) as never,
      processor: {} as never,
      logger: logger as never,
    };
    vi.mocked(executeReindex).mockClear();
    completeRestart(stateDir, record, deps);
    expect(existsSync(recordPath())).toBe(false);
    expect(executeReindex).not.toHaveBeenCalled();
    vi.mocked(executeReindex).mockRejectedValueOnce(new Error('qdrant down'));
    completeRestart(stateDir, { ...record, reindex: 'rules' }, deps);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'rules' }),
        'Config reindex deferred to the restart failed',
      );
    });
    expect(executeReindex).toHaveBeenCalledWith(expect.anything(), {
      scope: 'rules',
    });
  });

  it('ignores and removes an unreadable record, including a scope a reload cannot defer', () => {
    for (const text of [
      '{"cause":"crash"}',
      `{"cause":"root-gone","at":"x","reindex":"prune"}`,
    ]) {
      writeFileSync(recordPath(), text);
      expect(readRestartRecord(stateDir, logger as never)).toBeUndefined();
      expect(existsSync(recordPath())).toBe(false);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'Ignored an unreadable restart record',
    );
  });
});
