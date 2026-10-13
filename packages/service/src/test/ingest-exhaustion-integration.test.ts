/**
 * @module test/ingest-exhaustion-integration.test
 * Service integration (requires Qdrant): a provider that always answers 429 behind the real RateLimitedEmbeddingProvider with a tiny attempt budget; `POST /documents?wait=true` returns a per-document `failed` result with code `embedding_error` (never the search-only `embedding_unavailable`), writes no point and records the issue.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import { RateLimitedEmbeddingProvider } from '../embedding/rateLimitedProvider';
import { EmbeddingRateLimitError } from '../embedding/rateLimitError';
import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const REF = 'app://chat/thread/exhausted';
const PATH = '/threads/chat/thread/exhausted';

/** Limiter attempts per call: the budget the 429s exhaust. */
const ATTEMPTS = 2;

/** A provider whose every request is rejected as HTTP 429. */
function alwaysRateLimited(dimensions: number) {
  const state = { calls: 0 };
  const provider: EmbeddingProvider = {
    dimensions,
    embed: () => {
      state.calls += 1;
      return Promise.reject(
        new EmbeddingRateLimitError('HTTP 429 Too Many Requests', 10),
      );
    },
  };
  return { provider, state };
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: embedding exhaustion on ingest (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let limited: ReturnType<typeof alwaysRateLimited>;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        [PATH]: { body: { userId: 'u1', text: 'never embedded' } },
      });
      harness = await startServiceHarness({
        label: 'ingest_exhaustion',
        wrapEmbedding: (counted) => {
          limited = alwaysRateLimited(counted.dimensions);
          return new RateLimitedEmbeddingProvider(limited.provider, {
            rateLimitPerMinute: 1000,
            maxBackoffMs: 50,
            baseBackoffMs: 10,
            attempts: ATTEMPTS,
          });
        },
        config: {
          api: { cacheTtlMs: 0 },
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 5000,
              concurrency: 1,
            },
          },
          inferenceRules: [
            {
              name: RULE,
              description: 'Chat thread',
              match: { type: 'object', required: ['source', 'json'] },
              template: '{{userId}}: {{text}}\n',
            },
          ],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    it('limiter exhaustion during POST /documents?wait=true is a per-document embedding_error', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: { documents: [{ source: REF, rule: RULE }] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ results: unknown[] }>().results).toEqual([
        expect.objectContaining({
          source: REF,
          status: 'failed',
          error: expect.objectContaining({
            code: 'embedding_error',
          }) as unknown,
        }),
      ]);
      // The limiter spent its whole budget on 429s before giving up.
      expect(limited.state.calls).toBe(ATTEMPTS);
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 0)),
      ).toBeNull();

      const issues = await harness.app.inject({ url: '/issues' });
      expect(
        issues.json<{ issues: Record<string, unknown[]> }>().issues[REF],
      ).toEqual([expect.objectContaining({ type: 'embedding_error' })]);
    });
  },
);
