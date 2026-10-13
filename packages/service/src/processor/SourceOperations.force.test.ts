/**
 * @module processor/SourceOperations.force.test
 * SourceOperations.process `force` option: re-embeds and rewrites unchanged content (full reindex), keeps created_at; without it unchanged content is skipped.
 */

import { describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { doc, RULE, sourceReindexFixture } from '../test/sourceReindexFixture';

const REF = 'app://chat/thread/f';

describe('SourceOperations.process force', () => {
  it('skips unchanged content without force', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });
    await f.index(REF);

    const result = await f.processor.sourceOperations().process(REF, RULE);

    expect(result.status).toBe('unchanged');
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.store.upsert).toHaveBeenCalledOnce();
  });

  it('re-embeds unchanged content with force, keeping created_at', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });
    await f.index(REF);
    // A stored created_at no fresh index would produce: kept means kept.
    const stored = f.store.points.get(sourcePointId(REF, 0));
    if (!stored) throw new Error('expected an indexed point');
    stored.payload['created_at'] = 1;
    stored.payload['modified_at'] = 1;

    const result = await f.processor
      .sourceOperations()
      .process(REF, RULE, { force: true });

    expect(result).toMatchObject({ status: 'indexed', chunks: 1 });
    expect(f.embed).toHaveBeenCalledOnce();
    expect(f.store.upsert).toHaveBeenCalledTimes(2);
    const payload = f.store.points.get(sourcePointId(REF, 0))?.payload;
    expect(payload?.['created_at']).toBe(1);
    expect(payload?.['modified_at']).toBeGreaterThan(1);
  });
});
