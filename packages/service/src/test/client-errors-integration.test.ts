/**
 * @module test/client-errors-integration.test
 * Service integration (requires Qdrant): filters a real Qdrant rejects are 400 invalid_request on /search, /scan and /documents/delete (nothing deleted), and invalid /reindex path targets are 4xx, never 500.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';

/** A filter Qdrant cannot deserialize (unknown match variant). */
const BAD_FILTER = { must: [{ key: 'user_id', match: { bogus: 1 } }] };

describe.skipIf(!qdrantAvailable())(
  'Service integration: client errors are 4xx (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let watchDir: string;

    beforeAll(async () => {
      watchDir = normalizeSlashes(
        await mkdtemp(join(tmpdir(), 'jw-client-errors-')),
      );
      harness = await startServiceHarness({
        label: 'client_errors',
        config: { watch: { paths: [`${watchDir}/**/*`], ignored: [] } },
      });
    });

    afterAll(async () => {
      await harness.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    const post = async (url: string, payload: object) => {
      const res = await harness.app.inject({ method: 'POST', url, payload });
      return { status: res.statusCode, body: res.json<{ code: string }>() };
    };

    it.each([
      ['/search', { query: 'hello', filter: BAD_FILTER }],
      ['/scan', { filter: BAD_FILTER }],
      ['/scan', { filter: BAD_FILTER, countOnly: true }],
      ['/documents/delete', { filter: BAD_FILTER }],
    ])('%s with a filter Qdrant rejects -> 400', async (url, payload) => {
      const { status, body } = await post(url, payload);
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'invalid_request',
        error: 'Invalid filter',
      });
    });

    it('/reindex with a path outside the watch scope -> 403', async () => {
      const res = await post('/reindex', {
        scope: 'path',
        path: '/definitely/not/watched.md',
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'path_not_watched' });
    });

    it('/reindex with a watched path that does not exist -> 404', async () => {
      const path = `${watchDir}/no-such-file.md`;
      const res = await post('/reindex', { scope: 'path', path });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    });
  },
);
