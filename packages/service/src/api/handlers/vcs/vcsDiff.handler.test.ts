/**
 * @module api/handlers/vcs/vcsDiff.handler.test
 * GET /vcs/diff handler behavior: returns a diff between a commit and the
 * working tree, a diff between two specific commits, and 400s for
 * missing parameters.
 */

import { rm, writeFile } from 'node:fs/promises';
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
import { createVcsDiffHandler } from './vcsDiff';

describe('GET /vcs/diff', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

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
