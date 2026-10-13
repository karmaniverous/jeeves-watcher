/**
 * @module app/sources.test
 * Unit tests for source startup helpers (client creation, processor capability check, notify queue factory) and shutdown queue draining.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../processor';
import { SourceClient } from '../sources';
import { createTestConfig } from '../test/helpers';
import { drainQueues } from './shutdown';
import {
  createNotifyQueue,
  createSourceRetriever,
  isSourceProcessor,
} from './sources';

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
  it('detects source-capable processors', () => {
    expect(isSourceProcessor(fileOnlyProcessor)).toBe(false);
    expect(
      isSourceProcessor({
        processSource: vi.fn(),
      } as unknown as DocumentProcessorInterface),
    ).toBe(true);
  });

  it('routes runs to processSource', async () => {
    const processSource = vi
      .fn()
      .mockResolvedValue({ source: 'app://a', status: 'unchanged' });
    const queue = createNotifyQueue(
      { processSource } as unknown as DocumentProcessorInterface,
      createTestConfig(),
      logger,
    );
    queue.start();
    await expect(queue.processNow('app://a', 'r')).resolves.toEqual({
      source: 'app://a',
      status: 'unchanged',
    });
    expect(processSource).toHaveBeenCalledWith('app://a', 'r', {
      force: false,
    });
  });

  it('fails runs with source_unavailable when the processor cannot process sources', async () => {
    const queue = createNotifyQueue(
      fileOnlyProcessor,
      createTestConfig(),
      logger,
    );
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

  it('drains both queues, then stops the source queue', async () => {
    const order: string[] = [];
    await drainQueues(
      {
        queue: { drain: () => Promise.resolve(void order.push('file')) },
        sourceQueue: {
          drain: () => Promise.resolve(void order.push('source')),
          stop: () => Promise.resolve(void order.push('stop')),
        },
      },
      1000,
      logger,
    );
    expect(order).toEqual(['file', 'source', 'stop']);
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
