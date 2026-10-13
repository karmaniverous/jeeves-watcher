/**
 * @module processor/metadataRefresh.test
 * diffMetadata (changed values, removed keys) and refreshMetadata: set-payload for changed values, delete-payload for keys no longer projected, never a re-embed; payload write failures are `upsert_error`.
 */

import { describe, expect, it, vi } from 'vitest';

import type { VectorStore } from '../vectorStore';
import { ProcessingFailure } from './issueRecording';
import { diffMetadata, refreshMetadata } from './metadataRefresh';
import type { ResolvedDocument } from './resolvers/types';

const stored = {
  source: 'app://t/1',
  source_rule: 'chat',
  chunk_text: 'x',
  content_hash: 'h',
  total_chunks: 2,
  matched_rules: ['chat'],
  user_id: 'u1',
  tags: ['a', 'b'],
};

const projected = {
  source: 'app://t/1',
  source_rule: 'chat',
  matched_rules: ['chat'],
  user_id: 'u1',
  tags: ['a', 'b'],
};

describe('diffMetadata', () => {
  it('is unchanged when every projected value matches (deep)', () => {
    expect(diffMetadata(stored, projected)).toEqual({
      changed: false,
      removed: [],
    });
  });

  it('is changed when a value differs, a key is added or the rule changes', () => {
    expect(diffMetadata(stored, { ...projected, user_id: 'u2' }).changed).toBe(
      true,
    );
    expect(diffMetadata(stored, { ...projected, extra: 1 }).changed).toBe(true);
    expect(
      diffMetadata(stored, { ...projected, source_rule: 'other' }).changed,
    ).toBe(true);
  });

  it('lists stored non-system keys that are no longer projected', () => {
    const withoutTags = Object.fromEntries(
      Object.entries(projected).filter(([key]) => key !== 'tags'),
    );
    expect(diffMetadata(stored, withoutTags)).toEqual({
      changed: false,
      removed: ['tags'],
    });
  });
});

function setup(metadata: Record<string, unknown>) {
  const store = {
    setPayload: vi.fn().mockResolvedValue(undefined),
    deletePayload: vi.fn().mockResolvedValue(undefined),
  };
  const document = {
    identity: { kind: 'source', ref: 'app://t/1', rule: 'chat' },
    metadata,
    matchedRules: ['chat'],
    dates: () => Promise.resolve({ createdAt: 1, modifiedAt: 2 }),
  } as unknown as ResolvedDocument;
  const run = () =>
    refreshMetadata(store as unknown as VectorStore, document, stored);
  return { store, run };
}

describe('refreshMetadata', () => {
  it('writes nothing when nothing differs', async () => {
    const { store, run } = setup({ user_id: 'u1', tags: ['a', 'b'] });
    expect(await run()).toBe('same');
    expect(store.setPayload).not.toHaveBeenCalled();
    expect(store.deletePayload).not.toHaveBeenCalled();
  });

  it('deletes keys no longer projected on every chunk instead of re-embedding', async () => {
    const { store, run } = setup({ user_id: 'u1' });
    expect(await run()).toBe('updated');
    const ids = store.deletePayload.mock.calls[0][0] as string[];
    expect(ids).toHaveLength(2);
    expect(store.deletePayload).toHaveBeenCalledWith(ids, ['tags']);
    expect(store.setPayload).toHaveBeenCalledWith(
      ids,
      expect.objectContaining({ user_id: 'u1', modified_at: 2 }),
    );
  });

  it('sets changed values and keeps the pipeline matched_rules', async () => {
    const { store, run } = setup({
      user_id: 'u2',
      tags: ['a', 'b'],
      matched_rules: ['enrichment'],
    });
    expect(await run()).toBe('updated');
    expect(store.setPayload.mock.calls[0][1]).toMatchObject({
      user_id: 'u2',
      matched_rules: ['chat'],
    });
    expect(store.deletePayload).not.toHaveBeenCalled();
  });

  it('tags a payload write failure as upsert_error', async () => {
    const { store, run } = setup({ user_id: 'u1' });
    store.deletePayload.mockRejectedValue(new Error('qdrant down'));
    await expect(run()).rejects.toSatisfy(
      (e) => e instanceof ProcessingFailure && e.issueType === 'upsert_error',
    );
  });
});
