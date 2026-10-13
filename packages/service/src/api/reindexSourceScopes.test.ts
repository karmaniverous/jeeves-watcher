/**
 * @module api/reindexSourceScopes.test
 * runSourceScope goes through the notify queue: a reindex and a concurrent notification of the same reference never run in parallel and the final state is the latest; `force` reaches processSource; a stopped queue counts as failed and lists the reference; failed results and rejections are counted and listed with progress after each. resolveSourceScope needs the queue, the vector store, source operations and (scope issues) the issues store.
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceProcessorInterface } from '../processor/types';
import { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { sourceReindexFixture } from '../test/sourceReindexFixture';
import { resolveSourceScope, runSourceScope } from './reindexSourceScopes';

const RUN_MS = 100;
const logger = pino({ level: 'silent' });

/** Processor whose runs read the current content at start and track overlap. */
function createProcessor() {
  const content = new Map<string, string>();
  const indexed = new Map<string, string>();
  const forces: boolean[] = [];
  let active = 0;
  let maxActive = 0;
  const processor: SourceProcessorInterface = {
    processSource: (ref, _rule, options) => {
      forces.push(options?.force ?? false);
      const seen = content.get(ref) ?? 'none';
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<DocumentResult>((resolve) => {
        setTimeout(() => {
          active -= 1;
          indexed.set(ref, seen);
          resolve({ source: ref, status: 'indexed' });
        }, RUN_MS);
      });
    },
  };
  return { processor, content, indexed, forces, maxActive: () => maxActive };
}

const options = { concurrency: 4, logger, onProcessed: () => undefined };

describe('runSourceScope through the notify queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never runs a reindex and a notification of one reference in parallel; latest wins', async () => {
    const fake = createProcessor();
    const queue = new SourceNotifyQueue(fake.processor, { concurrency: 4 });
    queue.start();
    const ref = 'app://t/1';
    fake.content.set(ref, 'v1');

    const run = runSourceScope(
      { total: 1, targets: [{ ref, rule: 'r' }], queue, force: true },
      options,
    );
    await vi.advanceTimersByTimeAsync(10);
    // A notification arrives while the reindex run is in flight.
    fake.content.set(ref, 'v2');
    queue.enqueue(ref, 'r');
    await vi.advanceTimersByTimeAsync(3 * RUN_MS);

    expect(await run).toEqual({
      counts: { indexed: 1, unchanged: 0, deleted: 0, failed: 0 },
      failed: [],
    });
    expect(fake.maxActive()).toBe(1);
    expect(fake.indexed.get(ref)).toBe('v2');
    expect(fake.forces).toEqual([true, false]);
  });

  it('counts documents as failed once the queue is stopped', async () => {
    const fake = createProcessor();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    await queue.stop();

    const outcome = await runSourceScope(
      {
        total: 1,
        targets: [{ ref: 'app://t/1', rule: 'r' }],
        queue,
        force: false,
      },
      options,
    );

    expect(outcome).toMatchObject({
      counts: { failed: 1 },
      failed: ['app://t/1'],
    });
  });
});

describe('runSourceScope outcomes', () => {
  it('counts and lists failed results and rejections, reporting progress after each', async () => {
    const processNow = vi.fn((ref: string) => {
      if (ref === 'app://rejects') return Promise.reject(new Error('stopped'));
      const status = ref === 'app://fails' ? 'failed' : 'indexed';
      return Promise.resolve({ source: ref, status } as DocumentResult);
    });
    const onProcessed = vi.fn();

    const outcome = await runSourceScope(
      {
        total: 3,
        targets: ['app://ok', 'app://fails', 'app://rejects'].map((ref) => ({
          ref,
          rule: 'r',
        })),
        queue: { processNow },
        force: false,
      },
      { concurrency: 1, logger, onProcessed },
    );

    expect(outcome.counts).toEqual({
      indexed: 1,
      unchanged: 0,
      deleted: 0,
      failed: 2,
    });
    expect([...outcome.failed].sort()).toEqual([
      'app://fails',
      'app://rejects',
    ]);
    expect(onProcessed).toHaveBeenCalledTimes(3);
  });
});

describe('resolveSourceScope', () => {
  it('covers no sources without a notify queue', async () => {
    const { deps } = sourceReindexFixture({});
    const withoutQueue = { ...deps, sourceQueue: undefined };
    expect(
      await resolveSourceScope(withoutQueue, 'full', undefined),
    ).toBeUndefined();
    expect(await resolveSourceScope(deps, 'full', undefined)).toMatchObject({
      queue: deps.sourceQueue,
      force: true,
    });
  });

  it.each([
    ['a vector store', 'full', { vectorStore: undefined }],
    ['source operations on the processor', 'full', { processor: {} }],
    ['an issues store (issues scope)', 'issues', { issuesManager: undefined }],
  ] as const)(
    'covers no sources without %s',
    async (_label, scope, override) => {
      const { deps, store } = sourceReindexFixture({});
      const without = { ...deps, ...override } as typeof deps;
      expect(
        await resolveSourceScope(without, scope, undefined),
      ).toBeUndefined();
      expect(store.scrollPage).not.toHaveBeenCalled();
    },
  );
});
