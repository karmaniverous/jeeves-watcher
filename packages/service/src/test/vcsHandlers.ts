/**
 * @module test/vcsHandlers
 * Shared fixtures for VCS API handler tests (api/handlers/vcs/*.test.ts):
 * a mock Fastify reply, and a real git repo + VcsCoordinator with one
 * initial commit ("hello.txt" containing "hello world").
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { initRepo } from '../vcs/vcsBootstrap';
import { VcsCoordinator } from '../vcs/VcsCoordinator';
import { execFileAsync } from './git';

export const silentLogger = pino({ level: 'silent' });

/** Mock Fastify-style reply object that records status/body/headers. */
export function mockReply() {
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

/**
 * Create a temp git repo with an initial commit ("hello.txt" containing
 * "hello world") for VCS API handler tests.
 */
export async function makeVcsApiRoot(): Promise<string> {
  const root = normalizeSlashes(
    resolve(await mkdtemp(join(tmpdir(), 'vcs-api-a-'))),
  );

  await initRepo(root);
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: root,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], {
    cwd: root,
  });

  // Create initial commit
  await writeFile(join(root, 'hello.txt'), 'hello world', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial commit'], {
    cwd: root,
  });
  return root;
}

/** Build a VcsCoordinator watching `root` with default VCS config. */
export function makeVcsApiCoordinator(root: string): VcsCoordinator {
  const config = {
    vcs: { enabled: true, commitThrottleMs: 60000, maxBatchSize: 1000 },
    watch: { paths: [root], ignored: [] },
  } as unknown as JeevesWatcherConfig;
  return new VcsCoordinator(config, silentLogger);
}
