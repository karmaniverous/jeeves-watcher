/**
 * @module test/chat-thread-rule-integration.test
 * Service integration (requires Qdrant): the deployed `chat-thread` rule renders a three-streak thread from the stub callback to the expected Markdown and payload; records missing `userId` or with empty `msgs` fail `match` (match_failed issue async, per-document failed with ?wait=true) and write nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import {
  CHAT_THREAD_RULE,
  CHAT_THREAD_SCHEMAS,
  threeStreakThread,
} from './chatThreadRuleConfig';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = CHAT_THREAD_RULE.name;
const REF = 'app://chat/thread/s3';
const NO_USER = 'app://chat/thread/nouser';
const NO_MSGS = 'app://chat/thread/nomsgs';
const FROM = Date.UTC(2026, 9, 12, 14, 30);

/** `YYYY-MM-DD HH:mm` in host time, as the template's `dateFormat` (spec: TZ=UTC). */
function local(ms: number, withDate = true): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return withDate
    ? `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
    : hm;
}

const EXPECTED_MARKDOWN = [
  '---',
  'type: chat_history',
  `from: ${local(FROM)} UTC`,
  `to: ${local(FROM + 5 * 60_000)} UTC`,
  '---',
  '',
  '## User',
  '',
  'How do I lower my utilisation?',
  '',
  'My card limit is *$5,000*.',
  '',
  '## Assistant',
  '',
  'Pay the balance before the statement date.',
  '',
  '## User',
  '',
  'Thanks <3 & see you',
  '',
  '',
].join('\n');

describe.skipIf(!qdrantAvailable())(
  'Service integration: chat-thread rule (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;

    beforeAll(async () => {
      const thread = threeStreakThread(FROM);
      stub = await startStubSourceServer({
        '/watcher/sources/chat/thread/s3': { body: thread },
        '/watcher/sources/chat/thread/nouser': {
          body: { ...thread, userId: undefined },
        },
        '/watcher/sources/chat/thread/nomsgs': {
          body: {
            ...thread,
            streaks: [{ streakId: 's1', side: 'u-42', msgs: [] }],
          },
        },
      });
      harness = await startServiceHarness({
        label: 'cg_streak',
        config: {
          api: { cacheTtlMs: 0 },
          sources: {
            app: {
              url: `${stub.url}/watcher/sources/{id}`,
              timeoutMs: 5000,
              concurrency: 2,
            },
          },
          schemas: CHAT_THREAD_SCHEMAS,
          inferenceRules: [CHAT_THREAD_RULE],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    const post = async (url: string, payload: object) =>
      (
        await harness.app.inject({ method: 'POST', url, payload })
      ).json<unknown>();
    const notify = (ref: string, wait: boolean) =>
      post(wait ? '/documents?wait=true' : '/documents', {
        documents: [{ source: ref, rule: RULE }],
      });

    it('indexes the thread with its projected payload', async () => {
      expect(await notify(REF, true)).toEqual({
        results: [
          { source: REF, status: 'indexed', chunks: 1, matched_rules: [RULE] },
        ],
      });
      const payload = await harness.vectorStore.getPayload(
        sourcePointId(REF, 0),
      );
      expect(payload).toMatchObject({
        source: REF,
        source_rule: RULE,
        type: 'chat_history',
        user_id: 'u-42',
        streak_ids: ['s1', 's2', 's3'],
        from_ts: Math.floor(FROM / 1000),
        to_ts: Math.floor(FROM / 1000) + 300,
        title: `Chat ${local(FROM)} to ${local(FROM + 5 * 60_000, false)}`,
        total_chunks: 1,
      });
      expect(payload?.['chunk_text']).toContain('## Assistant');
      expect(payload?.['chunk_text']).toContain('Thanks <3 & see you');
    });

    it('renders the three-streak thread to the expected Markdown', async () => {
      expect(await post('/render', { source: REF })).toMatchObject({
        renderAs: 'md',
        content: EXPECTED_MARKDOWN,
      });
    });

    it.each([
      ['missing userId', NO_USER],
      ['empty msgs', NO_MSGS],
    ])('a record with %s fails match and writes nothing', async (_l, ref) => {
      expect(await notify(ref, true)).toMatchObject({
        results: [
          {
            source: ref,
            status: 'failed',
            error: {
              code: 'match_failed',
              details: expect.anything() as unknown,
            },
          },
        ],
      });
      expect(await notify(ref, false)).toMatchObject({ accepted: [ref] });
      await harness.sourceQueue.drain();
      const { issues } = (await harness.app.inject({ url: '/issues' })).json<{
        issues: Record<string, { type: string }[]>;
      }>();
      expect(issues[ref]).toEqual([
        expect.objectContaining({ type: 'match_failed' }),
      ]);
      expect(
        await harness.vectorStore.getPayload(sourcePointId(ref, 0)),
      ).toBeNull();
    });
  },
);
