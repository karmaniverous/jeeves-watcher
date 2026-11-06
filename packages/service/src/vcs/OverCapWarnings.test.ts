/**
 * @module vcs/OverCapWarnings.test
 * Over-cap warnings (D80, D201): one per path per process, worded for what happens (a tracked file is untracked whether it grew or was already over the cap at the first start; a new one is not staged), and again after the path was seen under the cap.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { OverCapWarnings } from './OverCapWarnings';

function setup() {
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  return { logger, warn, warnings: new OverCapWarnings() };
}

describe('OverCapWarnings', () => {
  it('says a tracked file is over the cap and is untracked, without claiming it grew', () => {
    const { logger, warn, warnings } = setup();
    warnings.warn('/r', 'big.pdf', 200, true, logger);
    expect(warn).toHaveBeenCalledWith(
      { root: '/r', path: 'big.pdf', size: 200 },
      'Tracked file is over vcs.maxFileBytes: untracking it (its history ends at its last committed version)',
    );
  });

  it('says a new file over the cap is not staged', () => {
    const { logger, warn, warnings } = setup();
    warnings.warn('/r', 'new.pdf', 200, false, logger);
    expect(warn).toHaveBeenCalledWith(
      { root: '/r', path: 'new.pdf', size: 200 },
      'File exceeds vcs.maxFileBytes: not staged',
    );
  });

  it('warns once per path until the path is cleared', () => {
    const { logger, warn, warnings } = setup();
    warnings.warn('/r', 'big.pdf', 200, true, logger);
    warnings.warn('/r', 'big.pdf', 300, true, logger);
    expect(warn).toHaveBeenCalledTimes(1);
    warnings.clear('big.pdf');
    warnings.warn('/r', 'big.pdf', 300, true, logger);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
