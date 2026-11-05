/**
 * @module watcher/changeSource/restart.test
 * The D196 restart seam: parcel never unsubscribes on Windows only, the log line names the cause and exit code (root and error only when given), and the fallback restarter exits once with the restart code.
 */

import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../../test/parcelStub';
import {
  exitingRestarter,
  logRestart,
  parcelNeverUnsubscribes,
  RESTART_EXIT_CODE,
} from './restart';

describe('restart seam (D196)', () => {
  it('parcel never unsubscribes on Windows only', () => {
    expect(parcelNeverUnsubscribes('win32')).toBe(true);
    expect(parcelNeverUnsubscribes('linux')).toBe(false);
    expect(parcelNeverUnsubscribes('darwin')).toBe(false);
  });

  it('uses a distinct exit code', () => {
    expect(RESTART_EXIT_CODE).toBe(75);
  });

  it('logs the cause and exit code, with root and error only when given', () => {
    const logger = createMockLogger();
    logRestart(logger as never, { cause: 'watch-config-changed' });
    expect(logger.warn).toHaveBeenCalledWith(
      { cause: 'watch-config-changed', exitCode: RESTART_EXIT_CODE },
      'Exiting for a service-manager restart (watch-config-changed): @parcel/watcher cannot unsubscribe on Windows (D196)',
    );
    logRestart(logger as never, {
      cause: 'subscription-error',
      root: '/r',
      err: new Error('boom'),
    });
    const [fields] = logger.warn.mock.lastCall as [Record<string, unknown>];
    expect(fields).toMatchObject({
      cause: 'subscription-error',
      root: '/r',
      err: { message: 'boom' },
    });
  });

  it('the fallback restarter logs and exits once', () => {
    const logger = createMockLogger();
    const exit = vi.fn();
    const restarter = exitingRestarter(logger as never, exit);
    restarter.restart({ cause: 'root-gone', root: '/r' });
    restarter.restart({ cause: 'subscription-error' });
    expect(exit).toHaveBeenCalledExactlyOnceWith(RESTART_EXIT_CODE);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
