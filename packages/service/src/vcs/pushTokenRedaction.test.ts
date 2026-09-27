/**
 * @module vcs/pushTokenRedaction.test
 * Regression tests for #245: an access token must never reach logs, the
 * pushErrors array, or the API response when a push fails.
 *
 * Pushes run real git against a local https remote that drops connections at
 * once (no network, no credential prompt).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVcsStatusHandler } from '../api/handlers/vcs/vcsStatus';
import type { JeevesWatcherConfig } from '../config/types';
import {
  type DroppingRemote,
  startDroppingRemote,
} from '../test/droppingRemote';
import { execFileAsync, TEST_GIT_TIMEOUT_MS } from '../test/git';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { gitPushNonInteractive } from './gitNetwork';
import { SquashManager } from './SquashManager';
import { initRepo } from './vcsBootstrap';
import { VcsCoordinator } from './VcsCoordinator';
import { VcsManager } from './VcsManager';

/** A token full of characters that URL encoding and base64 both change. */
const TOKEN = 'ghp_T0k/en@sp:ec+ial%20&=?#~';

/** Every form in which the token could plausibly leak. */
const TOKEN_FORMS = [
  TOKEN,
  encodeURIComponent(TOKEN),
  Buffer.from(TOKEN).toString('base64'),
  Buffer.from(`x-access-token:${TOKEN}`).toString('base64'),
];

/** Collect every string reachable from a value, including Error internals. */
function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.getOwnPropertyNames(value).flatMap((key) =>
    collectStrings((value as Record<string, unknown>)[key], seen),
  );
}

function expectNoToken(value: unknown): void {
  const text = collectStrings(value).join('\n');
  expect(text.length).toBeGreaterThan(0);
  for (const form of TOKEN_FORMS) expect(text).not.toContain(form);
}

/** A pino logger at trace level whose serialized output is captured. */
function capturingLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: pino({ level: 'trace' }, stream), lines };
}

async function initTestRepo(dir: string): Promise<void> {
  await initRepo(dir);
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

async function commitAt(
  cwd: string,
  name: string,
  daysAgo: number,
): Promise<void> {
  await writeFile(join(cwd, name), name, 'utf8');
  await execFileAsync('git', ['add', name], { cwd });
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await execFileAsync('git', ['commit', '-m', `add ${name}`], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

describe('access token redaction on failed push (#245)', () => {
  let dir: string;
  let remote: DroppingRemote;

  beforeEach(async () => {
    dir = normalizeSlashes(
      resolve(await mkdtemp(join(tmpdir(), 'vcs-redact-'))),
    );
    await initTestRepo(dir);
    remote = await startDroppingRemote();
  });

  afterEach(async () => {
    await remote.close();
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('keeps the token out of the thrown error', async () => {
    await commitAt(dir, 'a.txt', 0);
    const error: unknown = await gitPushNonInteractive({
      cwd: dir,
      remoteUrl: remote.url(),
      accessToken: TOKEN,
      timeout: TEST_GIT_TIMEOUT_MS,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const fields = error as Error & { cmd?: string; stderr?: string };
    expect(fields.cmd).toBeTypeOf('string');
    expect(fields.stderr).toBeTypeOf('string');
    expectNoToken(fields.message);
    expectNoToken(fields.stack);
    expectNoToken(fields.cmd);
    expectNoToken(error);
  });

  it('keeps the token out of VcsManager logs and pushErrors', async () => {
    const { logger, lines } = capturingLogger();
    const errorSpy = vi.spyOn(logger, 'error');
    const manager = new VcsManager(
      dir,
      {
        enabled: true,
        commitThrottleMs: 5000,
        maxBatchSize: 1000,
        staleLockThresholdMs: 60000,
        maxConsecutiveFailures: 5,
        branch: 'master',
      },
      logger,
      undefined,
      remote.url(),
      TOKEN,
    );
    await manager.start();
    const filePath = join(dir, 'push.txt');
    await writeFile(filePath, 'content', 'utf8');
    manager.fileChanged(filePath);
    await manager.flush();

    expect(manager.pushErrors).toHaveLength(1);
    expectNoToken(manager.pushErrors);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: dir }),
      'VCS push failed',
    );
    expectNoToken(errorSpy.mock.calls);
    expect(lines.join('')).toContain('VCS push failed');
    expectNoToken(lines);
  });

  it('keeps the token out of the GET /vcs/status response', async () => {
    const config = {
      vcs: {
        enabled: true,
        commitThrottleMs: 60000,
        maxBatchSize: 1000,
        defaultAccessToken: TOKEN,
      },
      watch: { paths: [{ path: dir, vcs: { remote: remote.url() } }] },
    } as unknown as JeevesWatcherConfig;
    const { logger, lines } = capturingLogger();
    const coordinator = new VcsCoordinator(config, logger);
    await coordinator.start();
    const filePath = join(dir, 'api.txt');
    await writeFile(filePath, 'content', 'utf8');
    coordinator.onFileChange(filePath, 'add');
    const [root] = coordinator.getRoots();
    await coordinator.getManager(root)?.flush();

    const handler = createVcsStatusHandler({ coordinator, logger });
    let body: unknown;
    const reply = {
      status: () => reply,
      header: () => reply,
      send: (data: unknown) => {
        body = data;
        return reply;
      },
    };
    await handler({ query: {} } as never, reply as never);
    await coordinator.stop();

    const roots = (body as { roots: Array<{ pushErrors: unknown[] }> }).roots;
    expect(roots[0].pushErrors).toHaveLength(1);
    expectNoToken(JSON.stringify(body));
    expect(lines.join('')).toContain('VCS push failed');
    expectNoToken(lines);
  });

  it('keeps the token out of SquashManager force-push logs', async () => {
    await commitAt(dir, 'old1.txt', 60);
    await commitAt(dir, 'old2.txt', 50);
    await commitAt(dir, 'new.txt', 1);
    const { logger, lines } = capturingLogger();
    const errorSpy = vi.spyOn(logger, 'error');
    const manager = new SquashManager(
      dir,
      { maxAgeDays: 30, maxVersions: 100, squashCron: '0 0 * * *' },
      logger,
      { remoteUrl: remote.url(), accessToken: TOKEN },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: dir }),
      'Squash force push failed',
    );
    expectNoToken(errorSpy.mock.calls);
    expectNoToken(lines);
  });
});
