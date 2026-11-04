/**
 * @module test/wire/wireApp
 * The real `createApiServer` on scriptable stubs (`wireStubs`) plus a temp config file and a real git repo, for the routes' wire baseline. Writes temp files; no network.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import pino from 'pino';

import { createApiServer } from '../../api';
import { VirtualRuleStore } from '../../rules/virtualRules';
import { execFileAsync } from '../git';
import { makeVcsApiCoordinator, makeVcsApiRoot } from '../vcsHandlers';
import {
  DEFAULT_WIRE_STATE,
  WIRE_KEY,
  wireServerOptions,
  type WireState,
} from './wireStubs';

/** Fixed git identity and dates, so every wire repo's commit SHAs are stable. */
const WIRE_GIT_ENV = {
  GIT_AUTHOR_NAME: 'Wire',
  GIT_AUTHOR_EMAIL: 'wire@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Wire',
  GIT_COMMITTER_EMAIL: 'wire@example.com',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

/** A started wire app. */
export interface WireApp {
  /** The Fastify app (VCS enabled). */
  app: FastifyInstance;
  /** The same server without a VCS coordinator. */
  appWithoutVcs: FastifyInstance;
  /** The app with VCS on and no source notify queue configured. */
  appWithoutSourceQueue: FastifyInstance;
  /** Stub behaviour (mutate per request; reset with {@link WireApp.reset}). */
  state: WireState;
  /** Restore {@link DEFAULT_WIRE_STATE} and the original config file. */
  reset: () => Promise<void>;
  /** VCS root (forward slashes). */
  vcsRoot: string;
  /** Commit holding the VCS fixture files. */
  commit: string;
  /** Temp directory holding the config file. */
  dir: string;
  /** Close both apps and remove temp files. */
  close: () => Promise<void>;
}

/** Files committed to the VCS root besides `hello.txt`. */
export const VCS_FILES: Record<string, string> = {
  'notes.md': '# Notes\n\nSome *markdown*.\n',
  'data.json': '{ "a": 1 }\n',
  'blob.xyz': 'opaque',
};

/** Config file contents the apply scenarios start from. */
export const WIRE_CONFIG_FILE = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'mock', dimensions: 3 },
  vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'wire' },
};

/** Bearer header the wire app accepts. */
export const WIRE_AUTH = { authorization: `Bearer ${WIRE_KEY}` };

/**
 * Start the wire app.
 *
 * @param logger - Logger for both apps (default silent).
 * @returns The started app; call `close` in `afterAll`.
 */
export async function startWireApp(
  logger: pino.Logger = pino({ level: 'silent' }),
): Promise<WireApp> {
  Object.assign(process.env, WIRE_GIT_ENV);
  const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-wire-'));
  const rules = new VirtualRuleStore();
  const configPath = join(dir, 'config.json');
  const writeConfig = () =>
    writeFile(configPath, JSON.stringify(WIRE_CONFIG_FILE, null, 2), 'utf8');
  await writeConfig();

  const vcsRoot = await makeVcsApiRoot();
  for (const [name, content] of Object.entries(VCS_FILES)) {
    await writeFile(join(vcsRoot, name), content, 'utf8');
  }
  await execFileAsync('git', ['add', '.'], { cwd: vcsRoot });
  await execFileAsync('git', ['commit', '-m', 'fixtures'], { cwd: vcsRoot });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: vcsRoot,
  });

  const state: WireState = { ...DEFAULT_WIRE_STATE };
  const options = wireServerOptions({ dir, configPath, state, logger, rules });

  const coordinator = makeVcsApiCoordinator(vcsRoot);
  const app = createApiServer({ ...options, vcsCoordinator: coordinator });
  const appWithoutVcs = createApiServer(options);
  const appWithoutSourceQueue = createApiServer({
    ...options,
    vcsCoordinator: coordinator,
    sourceQueue: undefined,
  });
  await app.ready();
  await appWithoutVcs.ready();
  await appWithoutSourceQueue.ready();

  return {
    app,
    appWithoutVcs,
    appWithoutSourceQueue,
    state,
    reset: async () => {
      Object.assign(state, DEFAULT_WIRE_STATE);
      await writeConfig();
      for (const source of Object.keys(rules.getAll()))
        rules.unregister(source);
      // Undo VCS writes (revert, exclude) so every scenario sees the same repo.
      await execFileAsync('git', ['checkout', '--', '.'], { cwd: vcsRoot });
      await execFileAsync('git', ['clean', '-fdq'], { cwd: vcsRoot });
    },
    vcsRoot,
    commit: stdout.trim(),
    dir,
    close: async () => {
      await app.close();
      await appWithoutVcs.close();
      await appWithoutSourceQueue.close();
      await rm(dir, { recursive: true, force: true });
      await rm(vcsRoot, { recursive: true, force: true });
    },
  };
}
