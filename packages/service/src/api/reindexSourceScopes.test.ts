/**
 * @module api/reindexSourceScopes.test
 * runSourceScope goes through the notify queue: a reindex and a concurrent notification of the same reference never run in parallel and the final state is the latest; `force` reaches processSource; a stopped queue counts as failed and lists the reference. resolveSourceScope needs the queue.
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
});
