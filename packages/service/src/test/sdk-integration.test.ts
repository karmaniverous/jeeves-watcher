/**
 * @module test/sdk-integration.test
 * SDK end-to-end (requires Qdrant): the jeeves-watcher-sdk client against the real Fastify API over HTTP with an API key: every in-scope method, filter helpers, notify 202 and wait=true, delete, and server error mapping.
 */

import {
  createWatcherClient,
  f,
  type WatcherClient,
  WatcherError,
} from '@karmaniverous/jeeves-watcher-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const API_KEY = 'sdk-integration-key';
const RULE = 'chat-thread';
const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';

const thread = (userId: string, text: string) => ({
  body: { userId, streaks: [{ msgs: [{ role: 'user', text }] }] },
});

describe.skipIf(!qdrantAvailable())(
  'SDK against the real service API (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let watcher: WatcherClient;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        '/threads/chat/thread/a': thread('u1', 'alpha message'),
        '/threads/chat/thread/b': thread('u2', 'bravo message'),
      });
      harness = await startServiceHarness({
        label: 'sdk',
        apiKey: API_KEY,
        listen: true,
        config: {
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 5000,
              concurrency: 2,
            },
          },
          inferenceRules: [
            {
              name: RULE,
              description: 'Chat thread',
              match: { type: 'object', required: ['source', 'json'] },
              schema: [
                {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', set: '{{json.userId}}' },
                    priority: { type: 'integer' },
                  },
                },
              ],
              template:
                '{{#each streaks}}{{#each msgs}}- {{role}}: {{text}}\n{{/each}}{{/each}}',
            },
          ],
        },
      });
      watcher = createWatcherClient({
        baseUrl: harness.baseUrl!,
        apiKey: API_KEY,
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    const caught = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (e: unknown) => e as WatcherError,
      );

    it('status works without an API key', async () => {
      const open = createWatcherClient({ baseUrl: harness.baseUrl! });
      await expect(open.status()).resolves.toMatchObject({ name: 'watcher' });
    });

    it('maps a 401 without the key to WatcherError', async () => {
      const anon = createWatcherClient({ baseUrl: harness.baseUrl! });
      const error = await caught(anon.issues());
      expect(error).toBeInstanceOf(WatcherError);
      expect(error).toMatchObject({
        status: 401,
        code: 'unauthorized',
        message: 'Unauthorized',
      });
    });

    it('notify (202), then search and scan with a user_id filter', async () => {
      const res = await watcher.documents.notify([
        { source: A, rule: RULE },
        { source: B, rule: 'no-such-rule' },
      ]);
      expect(res).toEqual({
        accepted: [A],
        rejected: [
          {
            source: B,
            error: expect.objectContaining({ code: 'rule_missing' }) as unknown,
          },
        ],
      });
      await harness.sourceQueue.drain();

      const hits = await watcher.search({
        query: '- user: alpha message',
        limit: 5,
        filter: f.and(f.eq('user_id', 'u1'), f.eq('source_rule', RULE)),
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.payload).toMatchObject({ source: A, user_id: 'u1' });

      const count = await watcher.scan({
        filter: f.eq('user_id', 'u1'),
        countOnly: true,
      });
      expect(count).toEqual({ count: 1 });
    });

    it('notify with wait=true returns per-document results', async () => {
      const res = await watcher.documents.notify(
        [
          { source: B, rule: RULE },
          { source: A, rule: RULE },
        ],
        { wait: true },
      );
      expect(res.results).toMatchObject([
        { source: B, status: 'indexed', chunks: 1 },
        { source: A, status: 'unchanged' },
      ]);
    });

    it('render, metadata and reindex by source', async () => {
      await expect(watcher.render({ source: A })).resolves.toMatchObject({
        renderAs: 'md',
        content: '- user: alpha message\n',
      });
      await expect(
        watcher.metadata({ source: A, metadata: { priority: 2 } }),
      ).resolves.toEqual({ ok: true, matched_rules: [RULE] });
      await expect(
        watcher.reindex({ scope: 'path', source: A, dryRun: true }),
      ).resolves.toMatchObject({
        status: 'dry_run',
        scope: 'path',
        plan: { toProcess: 1, byRoot: { app: 1 } },
      });
      await expect(watcher.issues()).resolves.toMatchObject({ count: 0 });
    });

    it('maps a server 404 error body', async () => {
      const error = await caught(
        watcher.metadata({ source: 'app://chat/thread/none', metadata: {} }),
      );
      expect(error).toMatchObject({
        status: 404,
        code: 'source_not_indexed',
        message: 'Source document not indexed',
      });
    });

    it('delete by filter and by sources', async () => {
      await expect(
        watcher.documents.delete({ filter: f.eq('user_id', 'u2') }),
      ).resolves.toEqual({ deleted: 1 });
      await expect(
        watcher.documents.delete({ sources: [A, B] }),
      ).resolves.toEqual({ deleted: 1 });
      await expect(
        watcher.scan({ filter: f.not(f.isEmpty('source')), countOnly: true }),
      ).resolves.toEqual({ count: 0 });
    });
  },
);
