/**
 * @module processor/documentPayloadWrite.test
 * Document payload writes (D139, D154): one by-filter write on the stored file_path (or source plus source-point conditions) when its keyword index is ready; otherwise ID addressing over chunk 0's count, limited to existing IDs, so a claim-state document (D105) updates every chunk it has.
 */

import { describe, expect, it, vi } from 'vitest';

import { pointId } from '../pointId';
import { documentFilter, writeDocumentPayload } from './documentPayloadWrite';

function store(ready: string[], existing?: (ids: string[]) => string[]) {
  return {
    keywordIndexReady: vi.fn((field: string) => ready.includes(field)),
    setPayloadWhere: vi.fn(() => Promise.resolve()),
    deletePayloadWhere: vi.fn(() => Promise.resolve()),
    existingIds: vi.fn((ids: string[]) =>
      Promise.resolve(existing ? existing(ids) : ids),
    ),
    setPayload: vi.fn(() => Promise.resolve()),
    deletePayload: vi.fn(() => Promise.resolve()),
  };
}

const file = { kind: 'file' as const, filePath: 'D:/Docs/A.md' };
const source = { kind: 'source' as const, ref: 'app://x/1', rule: 'app' };

describe('documentFilter', () => {
  it('matches the stored file_path casing from chunk 0', () => {
    expect(
      documentFilter(store(['file_path']), file, { file_path: 'D:/Docs/A.md' }),
    ).toEqual({
      must: [{ key: 'file_path', match: { value: 'D:/Docs/A.md' } }],
    });
  });

  it('falls back to the identity path when chunk 0 has no file_path', () => {
    expect(
      documentFilter(
        store(['file_path']),
        { kind: 'file', filePath: 'C:\\a.md' },
        {},
      ),
    ).toEqual({ must: [{ key: 'file_path', match: { value: 'C:/a.md' } }] });
  });

  it('selects a source document by reference, source points only', () => {
    expect(documentFilter(store(['source']), source, {})).toEqual({
      must: [
        { key: 'source', match: { value: 'app://x/1' } },
        { is_empty: { key: 'file_path' } },
      ],
      must_not: [{ is_empty: { key: 'source' } }],
    });
  });

  it('is undefined while the field has no ready keyword index', () => {
    expect(documentFilter(store([]), file, {})).toBeUndefined();
    expect(documentFilter(store(['file_path']), source, {})).toBeUndefined();
    expect(documentFilter(store(['source']), file, {})).toBeUndefined();
  });
});

describe('writeDocumentPayload', () => {
  it('writes by filter when the index is ready, never reading IDs', async () => {
    const s = store(['file_path']);
    const result = await writeDocumentPayload(
      s,
      file,
      { file_path: 'D:/Docs/A.md', total_chunks: 3 },
      { set: { a: 1 }, remove: ['old'] },
    );
    expect(result).toEqual({ by: 'filter' });
    const filter = {
      must: [{ key: 'file_path', match: { value: 'D:/Docs/A.md' } }],
    };
    expect(s.setPayloadWhere).toHaveBeenCalledWith(filter, { a: 1 });
    expect(s.deletePayloadWhere).toHaveBeenCalledWith(filter, ['old']);
    expect(s.existingIds).not.toHaveBeenCalled();
    expect(s.setPayload).not.toHaveBeenCalled();
  });

  it('skips the delete when nothing is removed', async () => {
    const s = store(['file_path']);
    await writeDocumentPayload(s, file, { total_chunks: 1 }, { set: { a: 1 } });
    expect(s.deletePayloadWhere).not.toHaveBeenCalled();
    const t = store([]);
    await writeDocumentPayload(t, file, { total_chunks: 1 }, { set: { a: 1 } });
    expect(t.deletePayload).not.toHaveBeenCalled();
  });

  it('falls back to the IDs that exist (claim state: high-water count, gaps)', async () => {
    const ids = [0, 1, 2, 3, 4].map((i) => pointId(file.filePath, i));
    // A failed streamed write: chunk 0 claims 5, only chunks 0-2 exist.
    const s = store([], (candidates) => candidates.slice(0, 3));
    const result = await writeDocumentPayload(
      s,
      file,
      { total_chunks: 5 },
      { set: { a: 1 }, remove: ['old'] },
    );
    expect(result).toEqual({ by: 'ids', points: 3 });
    expect(s.existingIds).toHaveBeenCalledWith(ids);
    expect(s.setPayload).toHaveBeenCalledWith(ids.slice(0, 3), { a: 1 });
    expect(s.deletePayload).toHaveBeenCalledWith(ids.slice(0, 3), ['old']);
    expect(s.setPayloadWhere).not.toHaveBeenCalled();
  });
});
