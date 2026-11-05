/**
 * @module processor/processor.locking.test
 * DocumentProcessor under per-document locks (D98, D118): every file operation waits for its document's lock (case-insensitive key), a bounded metadata/rules wait throws DocumentLockTimeoutError instead of being swallowed, a move holds both keys, source operations lock by reference.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { VectorStoreClient } from '../vectorStore';
import {
  DocumentLocks,
  DocumentLockTimeoutError,
  fileLockKey,
} from './DocumentLocks';
import { DocumentProcessor } from './index';
import { createMocks, defaultMergedMetadata } from './processorTestMocks';

vi.mock('./buildMetadata', () => ({
  buildMergedMetadata: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({
    size: 10,
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;

/** A promise with its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const mocks = createMocks();
  const locks = new DocumentLocks(mocks.logger);
  const processor = new DocumentProcessor({
    config: mocks.config,
    embeddingProvider: mocks.embeddingProvider,
    vectorStore: mocks.vectorStore as unknown as VectorStoreClient,
    compiledRules: [],
    logger: mocks.logger,
    documentLocks: locks,
  });
  return { ...mocks, locks, processor };
}

/** Let pending microtasks and a macrotask run. */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('DocumentProcessor locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());
  });

  it('processFile waits for the lock of the same file under another casing', async () => {
    const { locks, processor, vectorStore } = setup();
    const gate = deferred();
    const holder = locks.run(
      fileLockKey('C:/Docs/A.md'),
      'test',
      () => gate.promise,
    );
    const run = processor.processFile('c:\\docs\\a.md');
    await tick();
    expect(mockedBuildMergedMetadata).not.toHaveBeenCalled();
    expect(vectorStore.getPayload).not.toHaveBeenCalled();
    gate.resolve();
    await holder;
    await run;
    expect(mockedBuildMergedMetadata).toHaveBeenCalled();
  });

  it('deleteFile waits for the lock', async () => {
    const { locks, processor, vectorStore } = setup();
    const gate = deferred();
    const holder = locks.run(fileLockKey('/a.md'), 'test', () => gate.promise);
    const run = processor.deleteFile('/a.md');
    await tick();
    expect(vectorStore.delete).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([holder, run]);
    expect(vectorStore.delete).toHaveBeenCalled();
  });

  it.each([
    [
      'processMetadataUpdate',
      (p: DocumentProcessor) =>
        p.processMetadataUpdate('/a.md', { x: 1 }, { lockWaitMs: 20 }),
    ],
    [
      'processRulesUpdate',
      (p: DocumentProcessor) =>
        p.processRulesUpdate('/a.md', { lockWaitMs: 20 }),
    ],
  ])(
    '%s throws DocumentLockTimeoutError after a bounded wait and changes nothing',
    async (_name, call) => {
      const { locks, processor, vectorStore, issuesManager } = setup();
      const gate = deferred();
      const holder = locks.run(
        fileLockKey('/a.md'),
        'test',
        () => gate.promise,
      );
      await expect(call(processor)).rejects.toBeInstanceOf(
        DocumentLockTimeoutError,
      );
      expect(vectorStore.getPayload).not.toHaveBeenCalled();
      expect(vectorStore.setPayload).not.toHaveBeenCalled();
      expect(issuesManager.record).not.toHaveBeenCalled();
      gate.resolve();
      await holder;
    },
  );

  it('processMetadataUpdate without a bound waits until the lock frees', async () => {
    const { locks, processor, vectorStore } = setup();
    const gate = deferred();
    const holder = locks.run(fileLockKey('/a.md'), 'test', () => gate.promise);
    const run = processor.processMetadataUpdate('/a.md', { x: 1 });
    await tick();
    expect(vectorStore.getPayload).not.toHaveBeenCalled();
    gate.resolve();
    await holder;
    await expect(run).resolves.toBeNull();
    expect(vectorStore.getPayload).toHaveBeenCalled();
  });

  it('moveFile holds both keys (taken in sorted order)', async () => {
    const { locks, processor } = setup();
    const gate = deferred();
    // Sorted: '/new.md' is taken first, then the move waits for '/old.md'.
    const holder = locks.run(
      fileLockKey('/old.md'),
      'test',
      () => gate.promise,
    );
    let moved = false;
    const run = processor.moveFile('/old.md', '/new.md').then(() => {
      moved = true;
    });
    await tick();
    expect(moved).toBe(false);
    // The new key is held by the waiting move, so a rival waits too.
    const rival = vi.fn(() => Promise.resolve());
    const rivalRun = locks.run(fileLockKey('/new.md'), 'rival', rival);
    await tick();
    expect(rival).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([holder, run, rivalRun]);
    expect(moved).toBe(true);
    expect(rival).toHaveBeenCalledTimes(1);
  });

  it('source operations lock by reference', async () => {
    const { locks, processor } = setup();
    const ops = processor.sourceOperations();
    const gate = deferred();
    const holder = locks.run('app://a', 'test', () => gate.promise);
    await expect(
      ops.updateMetadata('app://a', { x: 1 }, { lockWaitMs: 20 }),
    ).rejects.toBeInstanceOf(DocumentLockTimeoutError);
    await expect(
      ops.withLock('app://a', 'deleteDocuments', () => Promise.resolve(1), {
        lockWaitMs: 20,
      }),
    ).rejects.toBeInstanceOf(DocumentLockTimeoutError);
    const processed = ops.process('app://a', 'rule');
    let settled = false;
    void processed.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    gate.resolve();
    await holder;
    await processed;
    expect(settled).toBe(true);
  });
});
