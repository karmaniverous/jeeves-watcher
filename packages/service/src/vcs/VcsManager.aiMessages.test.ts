/**
 * @module vcs/VcsManager.aiMessages.test
 * VcsManager AI-generated commit messages: uses the generator's output
 * when available, falls back to the template message when the generator
 * returns null or throws, and applies the revert prefix around the AI
 * description for reversions (falling back to the template revert
 * message when the generator fails).
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync } from '../test/git';
import { makeFastVcsConfig as makeConfig, makeTempRepo } from '../test/vcsRepo';
import { CommitMessageGenerator } from './CommitMessageGenerator';
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

  describe('AI commit messages', () => {
    it('uses AI-generated commit message when generator is provided', async () => {
      const generator = new CommitMessageGenerator(
        'anthropic',
        'claude-haiku-4-0',
        'test-key',
        silentLogger,
      );
      vi.spyOn(generator, 'generate').mockResolvedValue('Add test file');

      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        generator,
      );
      await manager.start();
      manager.endBaseline();

      const filePath = join(tempDir, 'ai-test.txt');
      await writeFile(filePath, 'hello', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('Add test file');
    });

    it('falls back to template when generator returns null', async () => {
      const generator = new CommitMessageGenerator(
        'anthropic',
        'claude-haiku-4-0',
        'test-key',
        silentLogger,
      );
      vi.spyOn(generator, 'generate').mockResolvedValue(null);

      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        generator,
      );
      await manager.start();
      manager.endBaseline();

      const filePath = join(tempDir, 'fallback.txt');
      await writeFile(filePath, 'hello', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
    });

    it('falls back to template when generator throws', async () => {
      const generator = new CommitMessageGenerator(
        'anthropic',
        'claude-haiku-4-0',
        'test-key',
        silentLogger,
      );
      vi.spyOn(generator, 'generate').mockRejectedValue(
        new Error('Network error'),
      );

      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        generator,
      );
      await manager.start();
      manager.endBaseline();

      const filePath = join(tempDir, 'error-fallback.txt');
      await writeFile(filePath, 'hello', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
    });

    it('uses revert prefix with AI description for reversions', async () => {
      const generator = new CommitMessageGenerator(
        'anthropic',
        'claude-haiku-4-0',
        'test-key',
        silentLogger,
      );
      vi.spyOn(generator, 'generate').mockResolvedValue(
        'Restore original config values',
      );

      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        generator,
      );
      await manager.start();
      manager.endBaseline();

      const filePath = join(tempDir, 'reverted-ai.txt');
      await writeFile(filePath, 'original', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

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
      expect(stdout).toContain('Restore original config values');
    });

    it('uses template revert message when AI fails for reversions', async () => {
      const generator = new CommitMessageGenerator(
        'anthropic',
        'claude-haiku-4-0',
        'test-key',
        silentLogger,
      );
      vi.spyOn(generator, 'generate').mockResolvedValue(null);

      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        generator,
      );
      await manager.start();

      const filePath = join(tempDir, 'revert-fallback.txt');
      await writeFile(filePath, 'original', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

      await writeFile(filePath, 'restored', 'utf8');
      manager.fileChanged(filePath);
      manager.addPendingReversion({
        glob: '*.txt',
        commit: 'deadbeef12345678',
        paths: [filePath],
      });

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('revert: *.txt to deadbee');
      expect(stdout).toContain('restored 1 files');
    });
  });
});
