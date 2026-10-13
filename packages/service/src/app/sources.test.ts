/**
 * @module app/sources.test
 * Unit tests for source startup helpers: client creation, the notify queue over source operations, the `withoutSourceSupport` adapter (file operations forwarded, source operations failing) and the `WatcherProcessor` type contract.
 */

import pino from 'pino';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ApiServerOptions } from '../api';
import { RequestError } from '../api/requestError';
import type {
  DocumentProcessor,
  DocumentProcessorInterface,
  WatcherProcessor,
} from '../processor';
import { SourceClient } from '../sources';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import {
  createNotifyQueue,
  createSourceRetriever,
  withoutSourceSupport,
} from './sources';

const logger = pino({ level: 'silent' });

/** A file-only processor whose every method is a mock. */
function fileOnly() {
  return {
    processFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    processMetadataUpdate: vi.fn().mockResolvedValue({ a: 1 }),
    processRulesUpdate: vi.fn().mockResolvedValue({ b: 2 }),
    renderFile: vi.fn().mockResolvedValue({ renderAs: 'md' }),
    moveFile: vi.fn().mockResolvedValue(undefined),
    updateRules: vi.fn(),
  };
}

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
      { sourceOperations } as unknown as WatcherProcessor,
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

  it('fails runs with source_unavailable for an adapted file-only processor', async () => {
    const queue = createNotifyQueue(
      withoutSourceSupport(fileOnly()),
      2,
      logger,
    );
    queue.start();
    const result = await queue.processNow('app://a', 'r');
    expect(result).toMatchObject({
      source: 'app://a',
      status: 'failed',
      error: { code: 'source_unavailable' },
    });
  });
});

describe('withoutSourceSupport', () => {
  it('forwards every file operation to the wrapped processor', async () => {
    const inner = fileOnly();
    const adapted = withoutSourceSupport(inner);
    const rules: Parameters<DocumentProcessorInterface['updateRules']>[0] = [];

    await adapted.processFile('a.md');
    await adapted.deleteFile('b.md');
    await expect(
      adapted.processMetadataUpdate('c.md', { x: 1 }),
    ).resolves.toEqual({ a: 1 });
    await expect(adapted.processRulesUpdate('d.md')).resolves.toEqual({ b: 2 });
    await expect(adapted.renderFile('e.md')).resolves.toEqual({
      renderAs: 'md',
    });
    await adapted.moveFile('f.md', 'g.md');
    adapted.updateRules(rules);

    expect(inner.processFile).toHaveBeenCalledWith('a.md');
    expect(inner.deleteFile).toHaveBeenCalledWith('b.md');
    expect(inner.processMetadataUpdate).toHaveBeenCalledWith('c.md', { x: 1 });
    expect(inner.processRulesUpdate).toHaveBeenCalledWith('d.md');
    expect(inner.renderFile).toHaveBeenCalledWith('e.md');
    expect(inner.moveFile).toHaveBeenCalledWith('f.md', 'g.md');
    expect(inner.updateRules).toHaveBeenCalledWith(rules, undefined, undefined);
  });

  it('fails every other source operation with 503 not_available', async () => {
    const ops = withoutSourceSupport(fileOnly()).sourceOperations();
    const notAvailable = {
      code: 'not_available',
      status: 503,
      message: 'Not available',
      extras: {
        message: 'Source documents are not supported by this instance.',
      },
    };
    const sync = [
      () => ops.validate('app://a', 'r'),
      () => ops.compiledRule('r'),
    ];
    for (const call of sync) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RequestError);
      expect(thrown).toMatchObject(notAvailable);
    }
    for (const pending of [
      ops.storedRule('app://a'),
      ops.render('app://a', 'r'),
      ops.updateMetadata('app://a', {}),
    ]) {
      await expect(pending).rejects.toMatchObject(notAvailable);
    }
  });
});

// WatcherProcessor contract, checked by `npm run typecheck` (no-ops at run
// time): the processor factory returns it, the API server requires it,
// DocumentProcessor implements it and a file-only processor is not one.
expectTypeOf<DocumentProcessor>().toExtend<WatcherProcessor>();
expectTypeOf<
  ReturnType<JeevesWatcherFactories['createDocumentProcessor']>
>().toEqualTypeOf<WatcherProcessor>();
expectTypeOf<ApiServerOptions['processor']>().toEqualTypeOf<WatcherProcessor>();
expectTypeOf<DocumentProcessorInterface>().not.toExtend<WatcherProcessor>();
