/**
 * @module test/config-reload-integration.test
 * Service integration (requires Qdrant): a live config reload of a running JeevesWatcher applies new rules but leaves `api.apiKey`, `sources` and payload indexes as they were at startup (Decision 16.10: restart to change).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JeevesWatcher } from '../app';
import { loadConfig } from '../config';
import { watcherDescriptor } from '../descriptor';
import {
  dropCollection,
  getPayloadSchema,
  qdrantAvailable,
  qdrantUrl,
  uniqueCollectionName,
} from './harness/qdrant';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const KEY_V1 = 'reload-key-startup';
const KEY_V2 = 'reload-key-edited';
const PATH = '/threads/chat/1';
const REF = 'app://chat/1';

const rule = (name: string) => ({
  name,
  description: 'Chat thread',
  match: { type: 'object', required: ['source', 'json'] },
  template: '{{userId}}: {{text}}\n',
});

/**
 * Poll until a condition holds.
 *
 * @param condition - Async condition.
 * @param timeoutMs - Give up after this long.
 */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 20000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: config reload keeps startup-only keys (requires Qdrant)',
  () => {
    const collectionName = uniqueCollectionName('config_reload');
    let root: string;
    let configPath: string;
    let startup: StubSourceServer;
    let edited: StubSourceServer;
    let watcher: JeevesWatcher;
    let server: FastifyInstance;

    /** The config file, with the given variable parts. */
    const configFile = (parts: {
      apiKey: string;
      sourceUrl: string;
      extraSource?: string;
      indexes: object[];
      ruleName: string;
    }) => ({
      watch: { paths: [join(root, 'watched', '**', '*')], ignored: [] },
      embedding: { provider: 'mock', model: 'mock', dimensions: 16 },
      vectorStore: {
        url: qdrantUrl(),
        collectionName,
        payloadIndexes: parts.indexes,
      },
      stateDir: join(root, 'state'),
      api: { host: '127.0.0.1', port: 0, apiKey: parts.apiKey, cacheTtlMs: 0 },
      sources: {
        app: { url: `${parts.sourceUrl}/threads/{id}`, timeoutMs: 5000 },
        ...(parts.extraSource
          ? { other: { url: `${parts.extraSource}/threads/{id}` } }
          : {}),
      },
      inferenceRules: [rule(parts.ruleName)],
      configWatch: { enabled: true, debounceMs: 100 },
      logging: { level: 'silent' },
    });

    const call = (path: string, key: string, payload?: object) =>
      server.inject({
        method: payload ? 'POST' : 'GET',
        url: path,
        headers: { authorization: `Bearer ${key}` },
        payload,
      });

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-reload-'));
      await mkdir(join(root, 'watched'), { recursive: true });
      startup = await startStubSourceServer({
        [PATH]: { body: { userId: 'u1', text: 'from startup source' } },
      });
      edited = await startStubSourceServer({
        [PATH]: { body: { userId: 'u1', text: 'from edited source' } },
      });
      configPath = join(root, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify(
          configFile({
            apiKey: KEY_V1,
            sourceUrl: startup.url,
            indexes: [{ field: 'user_id', type: 'keyword', isTenant: true }],
            ruleName: 'thread-v1',
          }),
        ),
      );
      watcher = new JeevesWatcher(
        await loadConfig(configPath),
        configPath,
        watcherDescriptor,
      );
      await watcher.start();
      server = (watcher as unknown as { server: FastifyInstance }).server;

      // Edit every startup-only key, plus a rule so the reload is observable.
      await writeFile(
        configPath,
        JSON.stringify(
          configFile({
            apiKey: KEY_V2,
            sourceUrl: edited.url,
            extraSource: edited.url,
            indexes: [
              { field: 'user_id', type: 'keyword', isTenant: true },
              { field: 'team_id', type: 'keyword' },
            ],
            ruleName: 'thread-v2',
          }),
        ),
      );
      await waitFor(async () => {
        const res = await call('/config', KEY_V1);
        return res.statusCode === 200 && res.body.includes('thread-v2');
      });
    }, 60_000);

    afterAll(async () => {
      await watcher.stop();
      await dropCollection(collectionName);
      await startup.close();
      await edited.close();
      await rm(root, { recursive: true, force: true });
    });

    it('keeps the startup api.apiKey', async () => {
      expect((await call('/issues', KEY_V1)).statusCode).toBe(200);
      expect((await call('/issues', KEY_V2)).statusCode).toBe(401);
    });

    it('keeps the startup sources (no new names, same callback URL)', async () => {
      const res = await call('/documents?wait=true', KEY_V1, {
        documents: [
          { source: 'other://chat/1', rule: 'thread-v2' },
          { source: REF, rule: 'thread-v2' },
        ],
      });
      expect(res.json()).toMatchObject({
        results: [
          { source: 'other://chat/1', error: { code: 'unknown_source' } },
          { source: REF, status: 'indexed' },
        ],
      });
      expect(startup.requests.map((r) => r.path)).toEqual([PATH]);
      expect(edited.requests).toEqual([]);
    });

    it('keeps the startup payload indexes', async () => {
      const schema = await getPayloadSchema(collectionName);
      expect(schema['user_id']).toMatchObject({ data_type: 'keyword' });
      expect(schema['team_id']).toBeUndefined();
    });
  },
);
