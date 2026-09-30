/**
 * @module api/handlers/vcs/vcsCheckExclusion.handler.test
 * GET /vcs/check-exclusion handler behavior: reports excluded:false for
 * tracked files, excluded:true (with the matching rule) for gitignored
 * files, 400s for a missing path, and 404s for a path outside any root.
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
import { createVcsCheckExclusionHandler } from './vcsCheckExclusion';

describe('GET /vcs/check-exclusion', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

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
