/**
 * @module api/catalog/rebuildMetadataHandler.test
 * POST /rebuild-metadata over the catalog route: it scrolls chunk 0 points only; each file's chunk 0 payload, re-read under the file's document lock (D98), becomes enrichment without any reserved system field (incl. matched_rules, dates and line ranges), so a setMetadata after the scroll is not overwritten; source points and vanished points are skipped; without locks it writes unlocked.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { DocumentLocks, fileLockKey } from '../../processor/DocumentLocks';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import type { ScrolledPoint } from '../../vectorStore';
import {
  type CatalogRebuildMetadataDeps,
  createCatalogRebuildMetadataHandler,
} from './rebuildMetadataHandler';

const filePayload = {
  file_path: 'd:/docs/a.md',
  chunk_index: 0,
  total_chunks: 1,
  content_hash: 'h',
  chunk_text: 'text',
  matched_rules: ['docs'],
  created_at: 1,
  modified_at: 2,
  line_start: 1,
  line_end: 3,
  title: 'Kept',
  domain: 'notes',
};

const filePoint: ScrolledPoint = { id: '1', payload: filePayload };
const gonePoint: ScrolledPoint = {
  id: '3',
  payload: { ...filePayload, file_path: 'd:/docs/gone.md' },
};
const sourcePoint: ScrolledPoint = {
  id: '2',
  payload: { source: 'app://t/1', source_rule: 'chat', user_id: 'u1' },
};

async function rebuild(
  deps: Omit<CatalogRebuildMetadataDeps, 'logger' | 'vectorStore'> & {
    getPayload: CatalogRebuildMetadataDeps['vectorStore']['getPayload'];
  },
) {
  const scroll = vi.fn(async function* () {
    yield* [filePoint, sourcePoint, gonePoint];
    await Promise.resolve();
  });
  const app = Fastify();
  await registerCatalogEntries(app, {
    rebuildMetadata: createCatalogRebuildMetadataHandler({
      ...deps,
      vectorStore: { scroll, getPayload: deps.getPayload },
      logger: pino({ level: 'silent' }),
    }),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/rebuild-metadata',
    payload: {},
  });
  await app.close();
  return { res, scroll };
}

describe('POST /rebuild-metadata', () => {
  it('copies non-system fields of each chunk 0, re-read under its lock', async () => {
    const set = vi.fn();
    const locks = new DocumentLocks(pino({ level: 'silent' }));
    const run = vi.spyOn(locks, 'run');
    const getPayload = vi.fn((id: string) =>
      Promise.resolve(id === '1' ? { ...filePayload, title: 'Fresh' } : null),
    );
    const { res, scroll } = await rebuild({
      enrichmentStore: { set } as never,
      documentLocks: locks,
      getPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(scroll).toHaveBeenCalledWith({
      must: [{ key: 'chunk_index', match: { value: 0 } }],
    });
    expect(run.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [fileLockKey('d:/docs/a.md'), 'rebuildMetadata'],
      [fileLockKey('d:/docs/gone.md'), 'rebuildMetadata'],
    ]);
    // The payload read inside the lock wins over the scrolled one.
    expect(set).toHaveBeenCalledExactlyOnceWith('d:/docs/a.md', {
      title: 'Fresh',
      domain: 'notes',
    });
  });

  it('waits for a held lock, then writes what that holder left', async () => {
    const set = vi.fn();
    const locks = new DocumentLocks(pino({ level: 'silent' }));
    let current: Record<string, unknown> = filePayload;
    let release!: () => void;
    const held = locks.run(
      fileLockKey('d:/docs/a.md'),
      'setMetadata',
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            current = { ...filePayload, owner: 'new' };
            resolve();
          };
        }),
    );
    const pending = rebuild({
      enrichmentStore: { set } as never,
      documentLocks: locks,
      getPayload: (id) => Promise.resolve(id === '1' ? current : null),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(set).not.toHaveBeenCalled();
    release();
    await held;
    await pending;
    expect(set).toHaveBeenCalledExactlyOnceWith('d:/docs/a.md', {
      title: 'Kept',
      domain: 'notes',
      owner: 'new',
    });
  });

  it('writes unlocked without document locks', async () => {
    const set = vi.fn();
    await rebuild({
      enrichmentStore: { set } as never,
      getPayload: (id) => Promise.resolve(id === '1' ? filePayload : null),
    });
    expect(set).toHaveBeenCalledExactlyOnceWith('d:/docs/a.md', {
      title: 'Kept',
      domain: 'notes',
    });
  });
});
