/**
 * @module app/sources.test
 * Unit tests for source startup helpers (client creation, notify queue factory over source operations) and shutdown queue draining.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../processor';
import { SourceClient } from '../sources';
import { createTestConfig } from '../test/helpers';
import { drainQueues } from './shutdown';
import { createNotifyQueue, createSourceRetriever } from './sources';

const logger = pino({ level: 'silent' });

const fileOnlyProcessor = {
  processFile: vi.fn(),
} as unknown as DocumentProcessorInterface;

describe('createSourceRetriever', () => {
  it('returns undefined when no sources are configured', () => {
    expect(createSourceRetriever(createTestConfig())).toBeUndefined();
    expect(
      createSourceRetriever({ ...createTestConfig(), sources: {} }),
    ).toBeUndefined();
  });

  it('builds a SourceClient from configured sources', () => {
    const retriever = createSourceRetriever({
      ...createTestConfig(),
      sources: {
        app: {
          url: 'http://127.0.0.1:1/threads/{id}',
          timeoutMs: 1000,
          concurrency: 2,
        },
      },
    });
    expect(retriever).toBeInstanceOf(SourceClient);
    expect(retriever?.has('app')).toBe(true);
  });
});

describe('createNotifyQueue', () => {
  it('routes each run to the source operations current at that run', async () => {
    const process = vi
      .fn()
      .mockResolvedValue({ source: 'app://a', status: 'unchanged' });
    const sourceOperations = vi.fn(() => ({ process }));
    const queue = createNotifyQueue(
      { sourceOperations } as unknown as DocumentProcessorInterface,
      2,
      logger,
    );
    expect(sourceOperations).not.toHaveBeenCalled();
    queue.start();
    await expect(queue.processNow('app://a', 'r')).resolves.toEqual({
      source: 'app://a',
      status: 'unchanged',
    });
    expect(process).toHaveBeenCalledWith('app://a', 'r', { force: false });
    expect(sourceOperations).toHaveBeenCalledOnce();
  });

  it.each([
    ['a file-only processor', fileOnlyProcessor],
    // The legacy capability no longer counts: the queue and the API agree.
    [
      'a processor with processSource but no source operations',
      { processSource: vi.fn() } as unknown as DocumentProcessorInterface,
    ],
  ])('fails runs with source_unavailable for %s', async (_label, processor) => {
    const queue = createNotifyQueue(processor, 2, logger);
    queue.start();
    const result = await queue.processNow('app://a', 'r');
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('source_unavailable');
  });
});

describe('drainQueues', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains and stops the file queue, then the source queue', async () => {
    const order: string[] = [];
    await drainQueues(
      {
        queue: {
          drain: () => Promise.resolve(void order.push('file')),
          stop: () => Promise.resolve(void order.push('file stop')),
        },
        sourceQueue: {
          drain: () => Promise.resolve(void order.push('source')),
          stop: () => Promise.resolve(void order.push('stop')),
        },
      },
      1000,
      logger,
    );
    expect(order).toEqual(['file', 'file stop', 'source', 'stop']);
  });

  it('stops the file queue after a drain timeout; idle when the stop finishes', async () => {
    vi.useFakeTimers();
    const stop = vi.fn().mockResolvedValue(undefined);
    const done = drainQueues(
      { queue: { drain: () => new Promise<void>(() => undefined), stop } },
      500,
      { warn: vi.fn() } as unknown as pino.Logger,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('gives up after the timeout with a warning and still stops the source queue', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const stop = vi.fn().mockResolvedValue(undefined);
    const done = drainQueues(
      {
        sourceQueue: { drain: () => new Promise<void>(() => undefined), stop },
      },
      500,
      { warn } as unknown as pino.Logger,
    );
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(warn).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
