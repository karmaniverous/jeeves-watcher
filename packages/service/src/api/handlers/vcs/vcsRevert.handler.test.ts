/**
 * @module api/handlers/vcs/vcsRevert.handler.test
 * POST /vcs/revert handler behavior: restores file content from a past
 * commit, skips/recreates deleted files depending on existingOnly, and
 * 400/404s for missing parameters or a glob outside any root.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../../../test/git';
import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  mockReply,
  silentLogger,
} from '../../../test/vcsHandlers';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsRevertHandler } from './vcsRevert';

describe('POST /vcs/revert', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

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
