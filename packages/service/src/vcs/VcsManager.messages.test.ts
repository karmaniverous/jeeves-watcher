/**
 * @module vcs/VcsManager.messages.test
 * VcsManager template commit message behavior: pending reversions produce
 * revert-prefixed messages (with mixed-change counts, cleared after
 * commit), and the baseline flag controls whether commits use the
 * "baseline:" or "watcher:" message prefix.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  commitCount,
  makeFastVcsConfig as makeConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import { VcsManager } from './VcsManager';

const silentLogger = pino({ level: 'silent' });

describe('VcsManager instance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-instance-');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('pendingReversions', () => {
    it('generates revert-prefixed commit message when reversion is pending', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      const filePath = join(tempDir, 'reverted.txt');
      await writeFile(filePath, 'original', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

      // Modify the file and record a reversion
      await writeFile(filePath, 'restored content', 'utf8');
      manager.fileChanged(filePath);

      const fakeCommit = 'abc1234567890def';
      manager.addPendingReversion({
        glob: '*.txt',
        commit: fakeCommit,
        paths: [filePath],
      });

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('revert: *.txt to abc1234');
      expect(stdout).toContain('restored 1 files');
    });

    it('includes other changes count in revert message when mixed', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      // Create initial commit
      const file1 = join(tempDir, 'reverted.txt');
      const file2 = join(tempDir, 'other.txt');
      await writeFile(file1, 'original', 'utf8');
      await writeFile(file2, 'other original', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

      // Modify both files
      await writeFile(file1, 'restored', 'utf8');
      await writeFile(file2, 'also changed', 'utf8');
      manager.fileChanged(file1);
      manager.fileChanged(file2);

      // Only file1 is a reversion
      manager.addPendingReversion({
        glob: '*.txt',
        commit: 'deadbeef12345678',
        paths: [file1],
      });

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('revert:');
      expect(stdout).toContain('restored 1 files');
      expect(stdout).toContain('(+ 1 other changes)');
    });

    it('clears pending reversions after commit', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      const file1 = join(tempDir, 'first.txt');
      await writeFile(file1, 'content', 'utf8');
      manager.fileChanged(file1);
      manager.addPendingReversion({
        glob: '*.txt',
        commit: 'abc1234567890def',
        paths: [file1],
      });

      await manager.flush();

      // End baseline so second commit uses normal message
      manager.endBaseline();

      // Second commit should use normal message
      const file2 = join(tempDir, 'second.txt');
      await writeFile(file2, 'normal change', 'utf8');
      manager.fileChanged(file2);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
      expect(stdout).not.toContain('revert:');
    });
  });

  describe('endBaseline', () => {
    it('uses baseline message before endBaseline is called', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();
      // isBaseline starts true — no endBaseline call

      const filePath = join(tempDir, 'baseline-file.txt');
      await writeFile(filePath, 'initial content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('baseline: batch');
      expect(stdout).toContain('1 files');
    });

    it('switches to normal messages after endBaseline is called', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      const filePath = join(tempDir, 'pre-scan.txt');
      await writeFile(filePath, 'initial', 'utf8');
      manager.fileChanged(filePath);

      // Signal end of initial scan — clears baseline flag
      manager.endBaseline();

      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
      expect(stdout).not.toContain('baseline');
    });

    it('uses normal message for second commit after endBaseline', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      const filePath = join(tempDir, 'first.txt');
      await writeFile(filePath, 'first', 'utf8');
      manager.fileChanged(filePath);
      await manager.flush();

      // First commit used baseline message
      const { stdout: first } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(first).toContain('baseline: batch');

      // End baseline then add another file
      manager.endBaseline();

      const filePath2 = join(tempDir, 'second.txt');
      await writeFile(filePath2, 'second', 'utf8');
      manager.fileChanged(filePath2);
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(2);
      const { stdout: second } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(second).toContain('watcher: batch');
      expect(second).not.toContain('baseline');
    });
  });
});
