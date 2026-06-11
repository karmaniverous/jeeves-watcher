/**
 * @module api/handlers/vcs/vcs.test
 * Tests for VCS API handlers using real git repos.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../../config/types';
import { normalizeSlashes } from '../../../util/normalizeSlashes';
import { initRepo } from '../../../vcs/vcsBootstrap';
import { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsCheckExclusionHandler } from './vcsCheckExclusion';
import { createVcsDiffHandler } from './vcsDiff';
import { createVcsExcludeHandler } from './vcsExclude';
import { createVcsHistoryHandler } from './vcsHistory';
import { createVcsRevertHandler } from './vcsRevert';
import { createVcsShowHandler } from './vcsShow';
import { createVcsStatusHandler } from './vcsStatus';

const execFileAsync = promisify(execFile);
const silentLogger = pino({ level: 'silent' });

/** Create a mock reply object. */
function mockReply() {
  const reply = {
    sent: false,
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(data: unknown) {
      reply.body = data;
      reply.sent = true;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name] = value;
      return reply;
    },
  };
  return reply;
}

describe('VCS API handlers', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = normalizeSlashes(
      resolve(await mkdtemp(join(tmpdir(), 'vcs-api-a-'))),
    );

    await initRepo(rootA);
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: rootA,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: rootA,
    });

    // Create initial commit
    await writeFile(join(rootA, 'hello.txt'), 'hello world', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: rootA });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], {
      cwd: rootA,
    });

    const config = {
      vcs: { enabled: true, commitDebounceMs: 60000, maxBatchSize: 1000 },
      watch: { paths: [rootA], ignored: [] },
    } as unknown as JeevesWatcherConfig;
    coordinator = new VcsCoordinator(config, silentLogger);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

  describe('GET /vcs/status', () => {
    it('returns status with root info', async () => {
      const handler = createVcsStatusHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as {
        enabled: boolean;
        roots: Array<{
          path: string;
          tracked: number;
          lastCommit: {
            hash: string;
            message: string;
            timestamp: string;
          } | null;
          remoteUrl: string | null;
          lastPush: string | null;
          pushErrors: Array<{ timestamp: string; message: string }>;
        }>;
      };
      expect(body.enabled).toBe(true);
      expect(body.roots).toHaveLength(1);
      expect(body.roots[0].path).toBe(rootA);
      expect(body.roots[0].tracked).toBeGreaterThan(0);
      expect(body.roots[0].lastCommit).toBeDefined();
      expect(body.roots[0].lastCommit!.message).toBe('initial commit');
      expect(body.roots[0].remoteUrl).toBeNull();
      expect(body.roots[0].lastPush).toBeNull();
      expect(body.roots[0].pushErrors).toEqual([]);
    });

    it('returns enabled:false when no VCS roots exist', async () => {
      const emptyConfig = {
        vcs: { enabled: false, commitDebounceMs: 5000, maxBatchSize: 1000 },
        watch: { paths: [], ignored: [] },
      } as unknown as JeevesWatcherConfig;
      const emptyCoordinator = new VcsCoordinator(emptyConfig, silentLogger);

      const handler = createVcsStatusHandler({
        coordinator: emptyCoordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { enabled: boolean; roots: unknown[] };
      expect(body.enabled).toBe(false);
      expect(body.roots).toHaveLength(0);
    });
  });

  describe('GET /vcs/history', () => {
    it('returns commit history for a glob', async () => {
      // Add a second commit
      await writeFile(join(rootA, 'hello.txt'), 'updated', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'update hello'], {
        cwd: rootA,
      });

      const handler = createVcsHistoryHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { glob: rootA + '/hello.txt' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as Array<{
        commit: string;
        message: string;
        timestamp: string;
        files: string[];
      }>;
      expect(body).toHaveLength(2);
      expect(body[0].message).toBe('update hello');
      expect(body[1].message).toBe('initial commit');
    });

    it('respects limit parameter', async () => {
      // Add more commits
      for (let i = 0; i < 3; i++) {
        await writeFile(join(rootA, 'hello.txt'), `v${String(i)}`, 'utf8');
        await execFileAsync('git', ['add', '.'], { cwd: rootA });
        await execFileAsync('git', ['commit', '-m', `commit ${String(i)}`], {
          cwd: rootA,
        });
      }

      const handler = createVcsHistoryHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { glob: rootA + '/hello.txt', limit: '2' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as unknown[];
      expect(body).toHaveLength(2);
    });

    it('returns 400 for missing glob', async () => {
      const handler = createVcsHistoryHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });

    it('returns 404 for glob outside any root', async () => {
      const handler = createVcsHistoryHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { glob: '/nonexistent/path/*.txt' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });

    it('filters by date range', async () => {
      // Use a future date so "since" excludes all commits
      const handler = createVcsHistoryHandler({
        coordinator,
        logger: silentLogger,
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const request = {
        query: { glob: rootA + '/hello.txt', since: futureDate },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as unknown[];
      expect(body).toHaveLength(0);
    });
  });

  describe('GET /vcs/show', () => {
    it('returns file content at a specific commit', async () => {
      // Get the commit hash
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: rootA,
      });
      const commitHash = stdout.trim();

      const handler = createVcsShowHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { path: rootA + '/hello.txt', commit: commitHash },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.body).toBe('hello world');
      expect(reply.headers['content-type']).toBe('text/plain');
    });

    it('returns 404 for nonexistent file at commit', async () => {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: rootA,
      });

      const handler = createVcsShowHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: {
          path: rootA + '/nonexistent.txt',
          commit: stdout.trim(),
        },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });

    it('returns 400 for missing parameters', async () => {
      const handler = createVcsShowHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });

    it('returns 404 for path outside any root', async () => {
      const handler = createVcsShowHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { path: '/nonexistent/file.txt', commit: 'HEAD' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });
  });

  describe('GET /vcs/diff', () => {
    it('returns diff between commits', async () => {
      // Get first commit hash
      const { stdout: firstHash } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      // Make a change
      await writeFile(join(rootA, 'hello.txt'), 'changed content', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'change hello'], {
        cwd: rootA,
      });

      const handler = createVcsDiffHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: {
          glob: rootA + '/hello.txt',
          commit: firstHash.trim(),
        },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as string;
      expect(body).toContain('hello world');
      expect(body).toContain('changed content');
      expect(reply.headers['content-type']).toBe('text/plain');
    });

    it('returns diff between two specific commits', async () => {
      const { stdout: firstHash } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      await writeFile(join(rootA, 'hello.txt'), 'v2', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'v2'], { cwd: rootA });

      const { stdout: secondHash } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      const handler = createVcsDiffHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: {
          glob: rootA + '/hello.txt',
          commit: firstHash.trim(),
          commitEnd: secondHash.trim(),
        },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as string;
      expect(body).toContain('hello world');
      expect(body).toContain('v2');
    });

    it('returns 400 for missing parameters', async () => {
      const handler = createVcsDiffHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });
  });

  describe('GET /vcs/check-exclusion', () => {
    it('returns excluded:false for tracked files', async () => {
      const handler = createVcsCheckExclusionHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { path: rootA + '/hello.txt' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { excluded: boolean };
      expect(body.excluded).toBe(false);
    });

    it('returns excluded:true for gitignored files', async () => {
      // Create a .gitignore
      await writeFile(join(rootA, '.gitignore'), '*.log\n', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'add gitignore'], {
        cwd: rootA,
      });

      const handler = createVcsCheckExclusionHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { path: rootA + '/debug.log' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as {
        excluded: boolean;
        rule?: string;
        source?: string;
      };
      expect(body.excluded).toBe(true);
      expect(body.rule).toBe('*.log');
    });

    it('returns 400 for missing path', async () => {
      const handler = createVcsCheckExclusionHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { query: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });

    it('returns 404 for path outside any root', async () => {
      const handler = createVcsCheckExclusionHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        query: { path: '/nonexistent/file.txt' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });
  });

  describe('POST /vcs/revert', () => {
    it('restores file content from a past commit', async () => {
      // Get initial commit hash
      const { stdout: initialHash } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      // Modify the file
      await writeFile(join(rootA, 'hello.txt'), 'modified content', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'modify hello'], {
        cwd: rootA,
      });

      const handler = createVcsRevertHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: rootA + '/hello.txt', commit: initialHash.trim() },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { restored: number; files: string[] };
      expect(body.restored).toBe(1);
      expect(body.files).toHaveLength(1);

      // Verify file content was restored
      const content = await readFile(join(rootA, 'hello.txt'), 'utf8');
      expect(content).toBe('hello world');
    });

    it('skips deleted files when existingOnly is true', async () => {
      // Create a second file and commit
      await writeFile(join(rootA, 'extra.txt'), 'extra content', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'add extra'], {
        cwd: rootA,
      });

      const { stdout: commitWithExtra } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      // Delete extra.txt and commit
      await rm(join(rootA, 'extra.txt'));
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'delete extra'], {
        cwd: rootA,
      });

      const handler = createVcsRevertHandler({
        coordinator,
        logger: silentLogger,
      });

      // Revert with existingOnly=true — should skip extra.txt since it doesn't exist
      const request = {
        body: {
          glob: rootA + '/',
          commit: commitWithExtra.trim(),
          existingOnly: true,
        },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { restored: number; files: string[] };
      // Only hello.txt exists on disk, extra.txt should be skipped
      expect(body.restored).toBe(1);
      expect(body.files[0]).toContain('hello.txt');
    });

    it('recreates deleted files when existingOnly is false', async () => {
      // Create a second file and commit
      await writeFile(join(rootA, 'extra.txt'), 'extra content', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'add extra'], {
        cwd: rootA,
      });

      const { stdout: commitWithExtra } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: rootA },
      );

      // Delete extra.txt and commit
      await rm(join(rootA, 'extra.txt'));
      await execFileAsync('git', ['add', '.'], { cwd: rootA });
      await execFileAsync('git', ['commit', '-m', 'delete extra'], {
        cwd: rootA,
      });

      const handler = createVcsRevertHandler({
        coordinator,
        logger: silentLogger,
      });

      // Revert with existingOnly=false (default) — should recreate extra.txt
      const request = {
        body: {
          glob: rootA + '/',
          commit: commitWithExtra.trim(),
        },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { restored: number; files: string[] };
      expect(body.restored).toBe(2);

      // Verify extra.txt was recreated
      const content = await readFile(join(rootA, 'extra.txt'), 'utf8');
      expect(content).toBe('extra content');
    });

    it('returns 400 for missing parameters', async () => {
      const handler = createVcsRevertHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { body: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });

    it('returns 404 for glob outside any root', async () => {
      const handler = createVcsRevertHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: '/nonexistent/path/*.txt', commit: 'HEAD' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });
  });

  describe('POST /vcs/exclude', () => {
    it('adds pattern to .gitignore at correct directory', async () => {
      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: rootA + '/*.log' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as {
        ok: boolean;
        gitignorePath: string;
        action: string;
      };
      expect(body.ok).toBe(true);
      expect(body.action).toBe('added');

      // Verify .gitignore was created/updated at root
      const gitignoreContent = await readFile(
        join(rootA, '.gitignore'),
        'utf8',
      );
      expect(gitignoreContent).toContain('*.log');
    });

    it('removes pattern from .gitignore', async () => {
      // First add the pattern
      await writeFile(join(rootA, '.gitignore'), '*.log\n*.tmp\n', 'utf8');

      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: rootA + '/*.log', remove: true },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as {
        ok: boolean;
        gitignorePath: string;
        action: string;
      };
      expect(body.ok).toBe(true);
      expect(body.action).toBe('removed');

      const content = await readFile(join(rootA, '.gitignore'), 'utf8');
      expect(content).not.toContain('*.log');
      expect(content).toContain('*.tmp');
    });

    it('places .gitignore at deepest common directory (locality)', async () => {
      // Create a subdirectory
      const subDir = join(rootA, 'sub', 'dir');
      await mkdir(subDir, { recursive: true });

      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: rootA + '/sub/dir/*.log' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as {
        ok: boolean;
        gitignorePath: string;
        action: string;
      };
      expect(body.ok).toBe(true);
      // .gitignore should be placed in sub/dir/, not at root
      expect(body.gitignorePath).toContain('sub/dir/.gitignore');

      const content = await readFile(
        join(rootA, 'sub', 'dir', '.gitignore'),
        'utf8',
      );
      expect(content).toContain('*.log');
    });

    it('returns 400 for missing glob', async () => {
      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = { body: {} } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(400);
    });

    it('returns 404 for invalid root', async () => {
      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: '*.log', root: '/nonexistent/root' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      expect(reply.statusCode).toBe(404);
    });

    it('does not duplicate existing pattern', async () => {
      await writeFile(join(rootA, '.gitignore'), '*.log\n', 'utf8');

      const handler = createVcsExcludeHandler({
        coordinator,
        logger: silentLogger,
      });

      const request = {
        body: { glob: rootA + '/*.log' },
      } as never;
      const reply = mockReply();
      await handler(request, reply as never);

      const body = reply.body as { ok: boolean; action: string };
      expect(body.ok).toBe(true);
      expect(body.action).toBe('added');

      const content = await readFile(join(rootA, '.gitignore'), 'utf8');
      const logEntries = content
        .split('\n')
        .filter((l) => l.trim() === '*.log');
      expect(logEntries).toHaveLength(1);
    });
  });
});
