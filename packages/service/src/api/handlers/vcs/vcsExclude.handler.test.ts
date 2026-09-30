/**
 * @module api/handlers/vcs/vcsExclude.handler.test
 * POST /vcs/exclude handler behavior: adds/removes a pattern in
 * .gitignore, places .gitignore at the deepest common directory, avoids
 * duplicate entries, and 400/404s for missing parameters or an invalid
 * root.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeVcsApiCoordinator,
  makeVcsApiRoot,
  mockReply,
  silentLogger,
} from '../../../test/vcsHandlers';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { createVcsExcludeHandler } from './vcsExclude';

describe('POST /vcs/exclude', () => {
  let rootA: string;
  let coordinator: VcsCoordinator;

  beforeEach(async () => {
    rootA = await makeVcsApiRoot();
    coordinator = makeVcsApiCoordinator(rootA);
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
  });

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
    const gitignoreContent = await readFile(join(rootA, '.gitignore'), 'utf8');
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
    const logEntries = content.split('\n').filter((l) => l.trim() === '*.log');
    expect(logEntries).toHaveLength(1);
  });
});
