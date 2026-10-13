/**
 * @module app/sources.test
 * Unit tests for source startup helpers (client creation, notify queue factory over source operations).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../processor';
import { SourceClient } from '../sources';
import { createTestConfig } from '../test/helpers';
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
    expect(retriever?.resolve('app://t').name).toBe('app');
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
