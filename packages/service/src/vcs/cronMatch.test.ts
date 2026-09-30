/**
 * @module vcs/cronMatch.test
 * 5-field cron matching used by the squash scheduler.
 */

import { describe, expect, it } from 'vitest';

import { cronMatchesNow } from './cronMatch';

describe('cronMatchesNow', () => {
  it('matches a wildcard expression at any time', () => {
    expect(cronMatchesNow('* * * * *')).toBe(true);
    expect(cronMatchesNow('* * * * *', new Date(2024, 1, 29, 23, 59))).toBe(
      true,
    );
  });

  it('matches specific minute and hour', () => {
    const now = new Date(2024, 5, 15, 14, 30); // June 15, 2024 14:30
    expect(cronMatchesNow('30 14 * * *', now)).toBe(true);
    expect(cronMatchesNow('31 14 * * *', now)).toBe(false);
    expect(cronMatchesNow('30 15 * * *', now)).toBe(false);
  });

  it('matches wildcard steps from the field minimum', () => {
    const at = (minute: number) => new Date(2024, 0, 1, 0, minute);
    expect(cronMatchesNow('*/5 * * * *', at(0))).toBe(true);
    expect(cronMatchesNow('*/5 * * * *', at(5))).toBe(true);
    expect(cronMatchesNow('*/5 * * * *', at(3))).toBe(false);
  });

  it('matches ranges inclusively, with optional steps', () => {
    const at = (hour: number) => new Date(2024, 0, 1, hour, 0);
    expect(cronMatchesNow('0 1-5 * * *', at(1))).toBe(true);
    expect(cronMatchesNow('0 1-5 * * *', at(5))).toBe(true);
    expect(cronMatchesNow('0 1-5 * * *', at(6))).toBe(false);
    expect(cronMatchesNow('0 0 * * *', at(0))).toBe(true);
    expect(cronMatchesNow('0 2-10/4 * * *', at(6))).toBe(true);
    expect(cronMatchesNow('0 2-10/4 * * *', at(4))).toBe(false);
  });

  it('matches any element of a list', () => {
    const at = (minute: number) => new Date(2024, 0, 1, 0, minute);
    expect(cronMatchesNow('0,15,30,45 * * * *', at(0))).toBe(true);
    expect(cronMatchesNow('0,15,30,45 * * * *', at(15))).toBe(true);
    expect(cronMatchesNow('0,15,30,45 * * * *', at(10))).toBe(false);
  });

  it('treats day-of-week 7 as Sunday', () => {
    const sunday = new Date(2024, 5, 16, 0, 0); // a Sunday
    const monday = new Date(2024, 5, 17, 0, 0);
    expect(cronMatchesNow('0 0 * * 0', sunday)).toBe(true);
    expect(cronMatchesNow('0 0 * * 7', sunday)).toBe(true);
    expect(cronMatchesNow('0 0 * * 7', monday)).toBe(false);
    expect(cronMatchesNow('0 0 * * 1', sunday)).toBe(false);
  });

  it('matches month and day-of-month (month is 1-based)', () => {
    expect(cronMatchesNow('0 0 25 12 *', new Date(2024, 11, 25, 0, 0))).toBe(
      true,
    );
    expect(cronMatchesNow('0 0 25 12 *', new Date(2024, 10, 25, 0, 0))).toBe(
      false,
    );
    expect(cronMatchesNow('0 0 24 12 *', new Date(2024, 11, 25, 0, 0))).toBe(
      false,
    );
  });

  it('rejects expressions without exactly five fields', () => {
    expect(cronMatchesNow('invalid')).toBe(false);
    expect(cronMatchesNow('* * * *')).toBe(false);
    expect(cronMatchesNow('* * * * * *')).toBe(false);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(
      cronMatchesNow('  30   14 * * *  ', new Date(2024, 5, 15, 14, 30)),
    ).toBe(true);
  });
});
