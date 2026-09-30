/**
 * @module vcs/VcsManager.remotePush.test
 * VcsManager remote push behavior: pushes to a configured remote after a
 * successful commit, does nothing when no remote is configured, records
 * (without blocking commits) a push error on failure — including for an
 * https remote with a token — and pushes to a non-https remote when a
 * token is set (the token is only sent to https:// remotes).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DroppingRemote,
  startDroppingRemote,
} from '../test/droppingRemote';
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

  describe('remote push', () => {
    let bareRemote: string;
    // Local https remote that drops connections at once: failing pushes need
    // no network and can never reach a credential prompt.
    let droppingRemote: DroppingRemote;

    beforeEach(async () => {
      bareRemote = await mkdtemp(join(tmpdir(), 'vcs-bare-'));
      await execFileAsync('git', ['init', '--bare'], { cwd: bareRemote });
      droppingRemote = await startDroppingRemote();
    });

    afterEach(async () => {
      await droppingRemote.close();
      await rm(bareRemote, { recursive: true, force: true });
    });

    it('pushes to remote after successful commit', async () => {
      const remoteUrl = bareRemote.replace(/\\/g, '/');
      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        undefined,
        remoteUrl,
      );
      await manager.start();

      const filePath = join(tempDir, 'push-test.txt');
      await writeFile(filePath, 'push content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Verify push succeeded: check bare repo has the commit
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: bareRemote },
      );
      expect(stdout).toContain('1 files');
      expect(manager.lastPushTime).not.toBeNull();
      expect(manager.pushErrors).toHaveLength(0);
    });

    it('does nothing when no remote is configured', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();

      const filePath = join(tempDir, 'no-remote.txt');
      await writeFile(filePath, 'no remote', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Commit should succeed without push
      expect(await commitCount(tempDir)).toBe(1);
      expect(manager.lastPushTime).toBeNull();
      expect(manager.pushErrors).toHaveLength(0);
    });

    it('records push error on failure without blocking commits', async () => {
      const logger = pino({ level: 'silent' });
      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        logger,
        undefined,
        droppingRemote.url('/nonexistent/repo.git'),
      );
      await manager.start();

      const filePath = join(tempDir, 'push-fail.txt');
      await writeFile(filePath, 'will fail push', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Commit should still succeed
      expect(await commitCount(tempDir)).toBe(1);
      expect(manager.lastPushTime).toBeNull();
      expect(manager.pushErrors).toHaveLength(1);
      expect(manager.pushErrors[0].timestamp).toBeDefined();
      expect(manager.pushErrors[0].message).toBeTruthy();
    });

    it('records a push error for an https remote with a token', async () => {
      const logger = pino({ level: 'silent' });
      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        logger,
        undefined,
        droppingRemote.url(),
        'tok/en@special',
      );
      await manager.start();

      const filePath = join(tempDir, 'encode-test.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // The push fails (dropping remote); token redaction is covered in
      // pushTokenRedaction.test.ts
      expect(manager.pushErrors).toHaveLength(1);
      // Commit should still succeed
      expect(await commitCount(tempDir)).toBe(1);
    });

    it('pushes to a non-https remote when a token is set', async () => {
      const remoteUrl = bareRemote.replace(/\\/g, '/');
      // The token is only sent (as an auth header) to https:// remotes, so a
      // local bare repo ignores it. See gitNetwork.auth.test.ts.
      const manager = new VcsManager(
        tempDir,
        makeConfig(),
        silentLogger,
        undefined,
        remoteUrl, // use plain path so push actually works
        'fake-token',
      );
      await manager.start();

      const filePath = join(tempDir, 'token-push.txt');
      await writeFile(filePath, 'token push content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Verify push succeeded via bare remote
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: bareRemote },
      );
      expect(stdout).toContain('1 files');
      expect(manager.lastPushTime).not.toBeNull();
    });
  });
});
