/**
 * @module vectorStore/writes.test
 * QdrantWriter: every write (upsert, delete, set-payload, delete-payload) is retried on a fresh client and gives up after the policy's attempts; empty writes make no request.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { QdrantWriter, type WriteClient } from './writes';

const policy = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };
const logger = pino({ level: 'silent' });

/** A client whose every method fails `failures` times (shared count), then succeeds. */
function makeClients(failures: number) {
  let remaining = failures;
  const call = vi.fn(() => {
    if (remaining > 0) {
      remaining--;
      return Promise.reject(new Error('ECONNRESET'));
    }
    return Promise.resolve({ status: 'completed' });
  });
  const created: WriteClient[] = [];
  const createClient = vi.fn(() => {
    const client = {
      upsert: call,
      delete: call,
      setPayload: call,
      deletePayload: call,
    } as unknown as WriteClient;
    created.push(client);
    return client;
  });
  return { call, created, createClient };
}

const writes: Array<[string, (w: QdrantWriter) => Promise<void>]> = [
  ['upsert', (w) => w.upsert([{ id: 'a', vector: [0], payload: {} }])],
  ['delete', (w) => w.delete(['a'])],
  ['setPayload', (w) => w.setPayload(['a'], { k: 1 })],
  ['deletePayload', (w) => w.deletePayload(['a'], ['k'])],
];

describe('QdrantWriter', () => {
  it.each(writes)('%s retries on a fresh client', async (_name, write) => {
    const { call, createClient } = makeClients(2);
    const writer = new QdrantWriter({
      collectionName: 'c',
      logger,
      createClient,
      retryPolicy: policy,
    });
    await write(writer);
    expect(call).toHaveBeenCalledTimes(3);
    // One client up front, one per retry.
    expect(createClient).toHaveBeenCalledTimes(3);
  });

  it.each(writes)(
    '%s gives up after the policy attempts',
    async (_name, write) => {
      const { call, createClient } = makeClients(10);
      const writer = new QdrantWriter({
        collectionName: 'c',
        logger,
        createClient,
        retryPolicy: policy,
      });
      await expect(write(writer)).rejects.toThrow('ECONNRESET');
      expect(call).toHaveBeenCalledTimes(3);
    },
  );

  it('makes no request for empty writes', async () => {
    const { call, createClient } = makeClients(0);
    const writer = new QdrantWriter({
      collectionName: 'c',
      logger,
      createClient,
    });
    await writer.upsert([]);
    await writer.delete([]);
    await writer.setPayload([], { k: 1 });
    await writer.deletePayload(['a'], []);
    expect(call).not.toHaveBeenCalled();
  });

  it('passes the collection and wait flag to the payload write', async () => {
    const { call, createClient } = makeClients(0);
    const writer = new QdrantWriter({
      collectionName: 'c',
      logger,
      createClient,
    });
    await writer.setPayload(['a'], { k: 1 });
    expect(call).toHaveBeenCalledWith('c', {
      wait: true,
      points: ['a'],
      payload: { k: 1 },
    });
  });
});
