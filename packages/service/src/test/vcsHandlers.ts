/**
 * @module test/vcsHandlers
 * Shared fixtures for VCS API handler tests (api/catalog/vcs*.test.ts):
 * a mock Fastify reply, a real git repo + VcsCoordinator with one initial
 * commit ("hello.txt" containing "hello world"), and a Fastify app serving
 * every `/vcs/*` catalog entry over that coordinator.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';

import { createCatalogVcsCheckExclusionHandler } from '../api/catalog/vcsCheckExclusionHandler';
import type { CatalogVcsDeps } from '../api/catalog/vcsDeps';
import { createCatalogVcsDiffHandler } from '../api/catalog/vcsDiffHandler';
import { createCatalogVcsExcludeHandler } from '../api/catalog/vcsExcludeHandler';
import { createCatalogVcsHistoryHandler } from '../api/catalog/vcsHistoryHandler';
import { createCatalogVcsRevertHandler } from '../api/catalog/vcsRevertHandler';
import { createCatalogVcsShowHandler } from '../api/catalog/vcsShowHandler';
import { createCatalogVcsStatusHandler } from '../api/catalog/vcsStatusHandler';
import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { initRepo } from '../vcs/vcsBootstrap';
import { VcsCoordinator } from '../vcs/VcsCoordinator';
import { registerCatalogEntries } from './catalogRoutes';
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

/**
 * A Fastify app serving every `/vcs/*` catalog entry (catalog request and
 * strict response validation) over `coordinator`. Close it after the test.
 *
 * @param coordinator - The VCS coordinator.
 * @returns The ready app.
 */
export async function serveVcsCatalog(
  coordinator: VcsCoordinator,
): Promise<FastifyInstance> {
  const deps: CatalogVcsDeps = { coordinator, logger: silentLogger };
  const app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    vcsStatus: createCatalogVcsStatusHandler(deps),
    vcsHistory: createCatalogVcsHistoryHandler(deps),
    vcsShow: createCatalogVcsShowHandler(deps),
    vcsDiff: createCatalogVcsDiffHandler(deps),
    vcsCheckExclusion: createCatalogVcsCheckExclusionHandler(deps),
    vcsRevert: createCatalogVcsRevertHandler(deps),
    vcsExclude: createCatalogVcsExcludeHandler(deps),
  });
  await app.ready();
  return app;
}

/** Build a VcsCoordinator watching `root` with default VCS config. */
export function makeVcsApiCoordinator(root: string): VcsCoordinator {
  const config = {
    vcs: { enabled: true, commitThrottleMs: 60000, maxBatchSize: 1000 },
    watch: { paths: [root], ignored: [] },
  } as unknown as JeevesWatcherConfig;
  return new VcsCoordinator(config, silentLogger);
}
