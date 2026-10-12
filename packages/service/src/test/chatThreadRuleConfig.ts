/**
 * @module test/chatThreadRuleConfig
 * Fixture: a `chat-thread` designated rule for chat-thread source documents (match contract, named schemas with `set` expressions, Markdown template), plus a thread-record builder. No I/O.
 */

import type { InferenceRule, JeevesWatcherConfig } from '../config/types';

/** Named schemas used by the rule (`schemas` in the deployed config). */
export const CHAT_THREAD_SCHEMAS: NonNullable<JeevesWatcherConfig['schemas']> =
  {
    'chat-base': {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['reference', 'chat_history'],
          description: 'Source discriminator. Filter on this in every search.',
          uiHint: 'select',
        },
        title: { type: 'string', description: 'Document title.' },
      },
    },
    'chat-thread': {
      type: 'object',
      properties: {
        type: { type: 'string', set: 'chat_history' },
        user_id: {
          type: 'string',
          set: '{{json.userId}}',
          description: 'End user. Mandatory filter for chat searches.',
        },
        streak_ids: {
          type: 'array',
          set: "{{json (pluck json.streaks 'streakId')}}",
          description: 'Every streak in the thread.',
        },
        from_ts: { type: 'integer', set: '{{toUnix json.fromTs}}' },
        to_ts: { type: 'integer', set: '{{toUnix json.toTs}}' },
        title: {
          type: 'string',
          set: "Chat {{dateFormat json.fromTs 'YYYY-MM-DD HH:mm'}} to {{dateFormat json.toTs 'HH:mm'}}",
        },
      },
    },
  };

/** The designated rule, as deployed. */
export const CHAT_THREAD_RULE: InferenceRule = {
  name: 'chat-thread',
  description: 'One chat thread.',
  match: {
    type: 'object',
    required: ['source', 'json'],
    properties: {
      source: {
        type: 'object',
        properties: {
          name: { enum: ['app', 'apptest'] },
          id: { type: 'string', pattern: '^chat/thread/[^/]+$' },
        },
      },
      json: {
        type: 'object',
        required: ['fromTs', 'toTs', 'userId', 'streaks'],
        properties: {
          fromTs: { type: 'integer', minimum: 0 },
          toTs: { type: 'integer', minimum: 0 },
          userId: { type: 'string', minLength: 1 },
          streaks: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['streakId', 'side', 'msgs'],
              properties: {
                streakId: { type: 'string', minLength: 1 },
                side: { type: 'string', minLength: 1 },
                msgs: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['msgId', 'ts', 'content'],
                    properties: {
                      ts: { type: 'integer', minimum: 0 },
                      content: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  schema: ['chat-base', 'chat-thread'],
  template:
    "---\ntype: chat_history\nfrom: {{dateFormat fromTs 'YYYY-MM-DD HH:mm'}} UTC\nto: {{dateFormat toTs 'YYYY-MM-DD HH:mm'}} UTC\n---\n{{#each streaks}}\n\n## {{#if (eq side 'assistant')}}Assistant{{else}}User{{/if}}\n{{#each msgs}}\n\n{{{content}}}\n{{/each}}{{/each}}\n",
};

/** One message of a streak. */
interface Msg {
  msgId: string;
  ts: number;
  content: string;
}

/** One streak of a thread. */
interface Streak {
  streakId: string;
  side: string;
  msgs: Msg[];
}

/**
 * Build a three-streak thread (user, assistant, user) as the callback returns it.
 *
 * @param fromTs - Start, epoch milliseconds.
 * @returns The raw thread record.
 */
export function threeStreakThread(fromTs: number) {
  const msg = (id: string, offsetMin: number, content: string): Msg => ({
    msgId: id,
    ts: fromTs + offsetMin * 60_000,
    content,
  });
  const streaks: Streak[] = [
    {
      streakId: 's1',
      side: 'u-42',
      msgs: [
        msg('m1', 0, 'How do I lower my utilisation?'),
        msg('m2', 1, 'My card limit is *$5,000*.'),
      ],
    },
    {
      streakId: 's2',
      side: 'assistant',
      msgs: [msg('m3', 2, 'Pay the balance before the statement date.')],
    },
    {
      streakId: 's3',
      side: 'u-42',
      msgs: [msg('m4', 5, 'Thanks <3 & see you')],
    },
  ];
  return { fromTs, toTs: fromTs + 5 * 60_000, userId: 'u-42', streaks };
}
