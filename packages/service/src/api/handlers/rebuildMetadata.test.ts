/**
 * @module api/handlers/rebuildMetadata.test
 * POST /rebuild-metadata: file point payloads become enrichment without any reserved system field (incl. matched_rules, dates and line ranges); source points are skipped.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { ScrolledPoint } from '../../vectorStore';
import { createRebuildMetadataHandler } from './rebuildMetadata';

const filePoint: ScrolledPoint = {
  id: '1',
  payload: {
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
  },
};

const sourcePoint: ScrolledPoint = {
  id: '2',
  payload: { source: 'app://t/1', source_rule: 'chat', user_id: 'u1' },
};

describe('POST /rebuild-metadata', () => {
  it('copies only non-system fields of file points into enrichment', async () => {
    const set = vi.fn();
    const app = Fastify();
    app.post(
      '/rebuild-metadata',
      createRebuildMetadataHandler({
        enrichmentStore: { set } as never,
        vectorStore: {
          scroll: async function* () {
            yield* [filePoint, sourcePoint];
            await Promise.resolve();
          },
        },
        logger: pino({ level: 'silent' }),
      }),
    );

    const res = await app.inject({ method: 'POST', url: '/rebuild-metadata' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(set).toHaveBeenCalledExactlyOnceWith('d:/docs/a.md', {
      title: 'Kept',
      domain: 'notes',
    });
  });
});
