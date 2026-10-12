/**
 * @module test/render-config-integration.test
 * Service integration (requires Qdrant) with the default response cache on: `/render { source }` always calls the source live (never cached) while file renders are cached; `GET /config` never exposes `sources` or their URLs and headers.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'cg-chat-thread';
const REF = 'cg://chat/thread/render';
const PATH = '/threads/chat/thread/render';
const SECRET_HEADER = 'Bearer render-config-secret';

/** A Markdown page whose front-matter title carries the version. */
const page = (v: number) => `---\ntitle: Version ${String(v)}\n---\nBody.\n`;

describe.skipIf(!qdrantAvailable())(
  'Service integration: render cache and config exposure (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let watchDir: string;
    let file: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-watch-'));
      file = join(watchDir, 'page.md');
      await writeFile(file, page(1), 'utf8');
      stub = await startStubSourceServer({
        [PATH]: { body: { text: 'version one' } },
      });
      harness = await startServiceHarness({
        label: 'render_config',
        config: {
          // Forward-slash glob, as in real configs.
          watch: {
            paths: [`${watchDir.replace(/\\/g, '/')}/**/*`],
            ignored: [],
          },
          // `api` left at its defaults: the 30 s response cache is on.
          sources: {
            cg: {
              url: `${stub.url}/threads/{id}`,
              headers: { Authorization: SECRET_HEADER },
              timeoutMs: 5000,
              concurrency: 2,
            },
          },
          inferenceRules: [
            {
              name: 'pages',
              description: 'Markdown pages (transformed renders are cacheable)',
              match: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: {
                    type: 'object',
                    properties: { path: { type: 'string', glob: '**/*.md' } },
                  },
                },
              },
              template: 'Page: {{frontmatter.title}}',
            },
            {
              name: RULE,
              description: 'Chat thread',
              match: { type: 'object', required: ['source', 'json'] },
              template: 'Thread: {{text}}',
            },
          ],
        },
      });
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: { documents: [{ source: REF, rule: RULE }] },
      });
      if (!res.body.includes('"indexed"')) {
        throw new Error(`Seeding failed: ${res.body}`);
      }
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    const render = async (payload: object) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/render',
        payload,
      });
      expect({ status: res.statusCode, body: res.body }).toMatchObject({
        status: 200,
      });
      return res.json<{ content: string }>().content;
    };

    it('serves file renders from the response cache (control)', async () => {
      expect(await render({ path: file })).toBe('Page: Version 1');
      await writeFile(file, page(2), 'utf8');
      expect(await render({ path: file })).toBe('Page: Version 1');
    });

    it('never serves /render { source } from the cache', async () => {
      const fetched = () => stub.requests.filter((r) => r.path === PATH).length;
      const before = fetched();
      expect(await render({ source: REF })).toBe('Thread: version one');
      stub.route(PATH, { body: { text: 'version two' } });
      expect(await render({ source: REF })).toBe('Thread: version two');
      expect(fetched()).toBe(before + 2);
      expect(stub.requests.at(-1)?.headers['authorization']).toBe(
        SECRET_HEADER,
      );
    });

    it('GET /config never exposes sources, their URLs or headers', async () => {
      const res = await harness.app.inject({ url: '/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('sources');
      expect(res.body).not.toContain(stub.url);
      expect(res.body).not.toContain(SECRET_HEADER);

      const query = await harness.app.inject({ url: '/config?path=$.sources' });
      expect(query.body).not.toContain(stub.url);
    });
  },
);
