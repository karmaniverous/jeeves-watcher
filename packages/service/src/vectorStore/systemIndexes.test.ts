/**
 * @module vectorStore/systemIndexes.test
 * SystemIndexTracker (D74, D154): ready when already keyword, conflict on another type (left alone), building until the background call returns (start never waits for it), failed on error unless the index exists, keyword readiness for system and non-system fields.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { type SystemIndexClient, SystemIndexTracker } from './systemIndexes';

const logger = pino({ level: 'silent' });

/** A promise with its resolver and rejecter. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient(
  schemas: Array<Record<string, { data_type: string }>>,
  create: () => Promise<void> = () => Promise.resolve(),
) {
  let read = 0;
  const getCollection = vi.fn(() => {
    const schema = schemas[Math.min(read, schemas.length - 1)];
    read++;
    return Promise.resolve({ payload_schema: schema });
  });
  const createPayloadIndex = vi.fn(create);
  return {
    client: {
      getCollection,
      createPayloadIndex,
    } as unknown as SystemIndexClient,
    getCollection,
    createPayloadIndex,
  };
}

describe('SystemIndexTracker', () => {
  it('is ready without creating anything when file_path is already keyword', async () => {
    const { client, createPayloadIndex } = fakeClient([
      { file_path: { data_type: 'keyword' } },
    ]);
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c', logger);
    await tracker.whenSettled();
    expect(createPayloadIndex).not.toHaveBeenCalled();
    expect(tracker.snapshot()).toEqual({ file_path: 'ready' });
    expect(tracker.keywordIndexReady('file_path')).toBe(true);
  });

  it('reports conflict and leaves another index type alone', async () => {
    const error = vi.spyOn(logger, 'error');
    const { client, createPayloadIndex } = fakeClient([
      { file_path: { data_type: 'text' } },
    ]);
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c', logger);
    expect(createPayloadIndex).not.toHaveBeenCalled();
    expect(tracker.snapshot()).toEqual({ file_path: 'conflict' });
    expect(tracker.keywordIndexReady('file_path')).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'file_path', actual: 'text' }),
      expect.stringContaining('another index type'),
    );
    error.mockRestore();
  });

  it('is building until the background wait=true call returns; start does not wait', async () => {
    const gate = deferred();
    const { client, createPayloadIndex } = fakeClient([{}], () => gate.promise);
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c', logger);
    expect(createPayloadIndex).toHaveBeenCalledWith('c', {
      field_name: 'file_path',
      field_schema: 'keyword',
      wait: true,
    });
    expect(tracker.snapshot()).toEqual({ file_path: 'building' });
    expect(tracker.keywordIndexReady('file_path')).toBe(false);
    gate.resolve();
    await tracker.whenSettled();
    expect(tracker.snapshot()).toEqual({ file_path: 'ready' });
    expect(tracker.keywordIndexReady('file_path')).toBe(true);
  });

  it('is failed when creation fails and the index does not exist', async () => {
    const { client } = fakeClient([{}, {}], () =>
      Promise.reject(new Error('boom')),
    );
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c', logger);
    await tracker.whenSettled();
    expect(tracker.snapshot()).toEqual({ file_path: 'failed' });
    expect(tracker.keywordIndexReady('file_path')).toBe(false);
  });

  it('is ready when the call failed (e.g. client timeout) but the index exists', async () => {
    const { client } = fakeClient(
      [{}, { file_path: { data_type: 'keyword' } }],
      () => Promise.reject(new Error('timeout')),
    );
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c', logger);
    await tracker.whenSettled();
    expect(tracker.snapshot()).toEqual({ file_path: 'ready' });
  });

  it('is failed when the call and the re-read both fail', async () => {
    let reads = 0;
    const client = {
      getCollection: vi.fn(() =>
        reads++ === 0
          ? Promise.resolve({ payload_schema: {} })
          : Promise.reject(new Error('down')),
      ),
      createPayloadIndex: vi.fn(() => Promise.reject(new Error('down'))),
    } as unknown as SystemIndexClient;
    const tracker = new SystemIndexTracker();
    await tracker.start(client, 'c');
    await tracker.whenSettled();
    expect(tracker.snapshot()).toEqual({ file_path: 'failed' });
  });

  it('reads keyword readiness of other fields (source) from the startup schema', async () => {
    const { client } = fakeClient([
      {
        file_path: { data_type: 'keyword' },
        source: { data_type: 'keyword' },
        chunk_text: { data_type: 'text' },
      },
    ]);
    const tracker = new SystemIndexTracker();
    expect(tracker.keywordIndexReady('source')).toBe(false);
    await tracker.start(client, 'c', logger);
    expect(tracker.keywordIndexReady('source')).toBe(true);
    expect(tracker.keywordIndexReady('chunk_text')).toBe(false);
    expect(tracker.keywordIndexReady('domain')).toBe(false);
  });

  it('a system index of a non-keyword type is never keyword-ready', async () => {
    const { client } = fakeClient([{ n: { data_type: 'integer' } }]);
    const tracker = new SystemIndexTracker([{ field: 'n', type: 'integer' }]);
    await tracker.start(client, 'c', logger);
    expect(tracker.snapshot()).toEqual({ n: 'ready' });
    expect(tracker.keywordIndexReady('n')).toBe(false);
  });

  it('reports nothing before start', () => {
    expect(new SystemIndexTracker().snapshot()).toEqual({});
  });
});
