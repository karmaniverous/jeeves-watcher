/**
 * @module vcs/SquashManager.retention.test
 * Tests for SquashManager.calculateRetentionBoundary: the tighter of the
 * age and count constraints wins, and no boundary is returned when all
 * commits are within both constraints. Squash mechanism/push/pause tests
 * live in SquashManager.mechanism.test.ts and
 * SquashManager.pushAndPause.test.ts; safety guards live in
 * SquashManager.guards.test.ts; cron matching in cronMatch.test.ts.
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { makeRetention } from '../test/squashRepo';
import { SquashManager } from './SquashManager';

const silentLogger = pino({ level: 'silent' });

describe('SquashManager.calculateRetentionBoundary', () => {
  it('age constraint wins when it is tighter', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 7, maxVersions: 100 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 20 * 86400000) }, // 20 days ago
      { hash: 'b', date: new Date(now.getTime() - 10 * 86400000) }, // 10 days ago
      { hash: 'c', date: new Date(now.getTime() - 5 * 86400000) }, // 5 days ago
      { hash: 'd', date: new Date(now.getTime() - 1 * 86400000) }, // 1 day ago
    ];

    // maxAgeDays=7: commits a,b are older than 7 days -> ageBoundary=2 (c is first to keep)
    // maxVersions=100: countBoundary=0 (all 4 within 100)
    // tighter=max(2,0)=2
    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(2);
  });

  it('count constraint wins when it is tighter', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 365, maxVersions: 2 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 5 * 86400000) },
      { hash: 'b', date: new Date(now.getTime() - 3 * 86400000) },
      { hash: 'c', date: new Date(now.getTime() - 2 * 86400000) },
      { hash: 'd', date: new Date(now.getTime() - 1 * 86400000) },
    ];

    // maxAgeDays=365: all within range -> ageBoundary=0
    // maxVersions=2: countBoundary=4-2=2
    // tighter=max(0,2)=2
    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(2);
  });

  it('returns 0 when all commits are within both constraints', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 365, maxVersions: 100 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 5 * 86400000) },
      { hash: 'b', date: new Date(now.getTime() - 1 * 86400000) },
    ];

    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(0);
  });
});
