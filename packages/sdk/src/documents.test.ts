/**
 * @module documents.test
 * Unit tests for the documents group with an injected fetch: notify 202 vs ?wait=true overloads, client-side validation (count, references, no push keys) and delete by sources or filter.
 */

import {
  type DocumentsAcceptedResponse,
  type DocumentsResultsResponse,
  MAX_DOCUMENTS_PER_REQUEST,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createWatcherClient } from './createWatcherClient';
import { f } from './filters';
import { type CannedResponse, mockFetch } from './test/mockFetch';

const BASE = 'http://watcher.test:1936';
const DOC = { source: 'app://chat/thread/1', rule: 'chat-thread' };
const ACCEPTED = { accepted: [DOC.source], rejected: [] };
const RESULTS = {
  results: [{ source: DOC.source, status: 'indexed', chunks: 1 }],
};

function client(respond: CannedResponse) {
  const mock = mockFetch(respond);
  return {
    mock,
    watcher: createWatcherClient({ baseUrl: BASE, fetch: mock.fetch }),
  };
}

describe('documents.notify', () => {
  it('posts { documents } to /documents and returns the 202 body', async () => {
    const { watcher, mock } = client({ status: 202, body: ACCEPTED });
    const res = await watcher.documents.notify([DOC]);
    expectTypeOf(res).toEqualTypeOf<DocumentsAcceptedResponse>();
    expect(res).toEqual(ACCEPTED);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/documents`,
      method: 'POST',
      body: { documents: [DOC] },
    });
  });

  it('wait: false behaves like the default', async () => {
    const { watcher, mock } = client({ status: 202, body: ACCEPTED });
    await watcher.documents.notify([DOC], { wait: false });
    expect(mock.calls[0]?.url).toBe(`${BASE}/documents`);
  });

  it('wait: true adds ?wait=true and returns per-document results', async () => {
    const { watcher, mock } = client({ body: RESULTS });
    const res = await watcher.documents.notify([DOC], { wait: true });
    expectTypeOf(res).toEqualTypeOf<DocumentsResultsResponse>();
    expect(res).toEqual(RESULTS);
    expect(mock.calls[0]?.url).toBe(`${BASE}/documents?wait=true`);
  });

  it.each([
    [true, 200, RESULTS, `${BASE}/documents?wait=true`],
    [false, 202, ACCEPTED, `${BASE}/documents`],
  ] as const)(
    'a runtime boolean (%s) yields the union type and the matching body',
    async (flag, status, body, url) => {
      const { watcher, mock } = client({ status, body });
      const wait: boolean = flag;
      const res = await watcher.documents.notify([DOC], { wait });
      expectTypeOf(res).toEqualTypeOf<
        DocumentsAcceptedResponse | DocumentsResultsResponse
      >();
      expect(res).toEqual(body);
      expect(mock.calls[0]?.url).toBe(url);
    },
  );

  it('rejects a 202 shape when wait=true expected results', async () => {
    const { watcher } = client({ status: 202, body: ACCEPTED });
    await expect(
      watcher.documents.notify([DOC], { wait: true }),
    ).rejects.toMatchObject({ code: 'invalid_response', status: 202 });
  });

  it.each([
    ['an empty list', []],
    [
      'more than the maximum',
      Array.from({ length: MAX_DOCUMENTS_PER_REQUEST + 1 }, () => DOC),
    ],
    ['a malformed reference', [{ source: 'not a ref', rule: 'r' }]],
    ['an empty rule', [{ source: DOC.source, rule: '' }]],
    ['pushed content (notify only)', [{ ...DOC, text: 'inline' }]],
    [
      'pushed properties (notify only)',
      [{ ...DOC, properties: { user_id: 'u1' } }],
    ],
  ])('rejects %s client-side', async (_, documents) => {
    const { watcher, mock } = client({ status: 202, body: ACCEPTED });
    await expect(
      watcher.documents.notify(documents as (typeof DOC)[]),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('documents.delete', () => {
  it('posts { sources } to /documents/delete', async () => {
    const { watcher, mock } = client({ body: { deleted: 1 } });
    await expect(
      watcher.documents.delete({ sources: [DOC.source] }),
    ).resolves.toEqual({ deleted: 1 });
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/documents/delete`,
      method: 'POST',
      body: { sources: [DOC.source] },
    });
  });

  it('posts { filter }', async () => {
    const { watcher, mock } = client({ body: { deleted: 4 } });
    const filter = f.eq('user_id', 'u1');
    await watcher.documents.delete({ filter });
    expect(mock.calls[0]?.body).toEqual({ filter });
  });

  it('rejects both forms at once, and empty sources', async () => {
    const { watcher, mock } = client({ body: { deleted: 0 } });
    await expect(
      watcher.documents.delete({ sources: [DOC.source], filter: {} }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      watcher.documents.delete({ sources: [] }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mock.calls).toHaveLength(0);
  });

  it.each([
    ['f.and() with no operands', f.and()],
    ['{}', {}],
    ['{ must: [] }', { must: [] }],
    ['f.and(f.and(), f.or())', f.and(f.and(), f.or())],
  ])('refuses a condition-free filter: %s', async (_label, filter) => {
    const { watcher, mock } = client({ body: { deleted: 0 } });
    await expect(watcher.documents.delete({ filter })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(mock.calls).toHaveLength(0);
  });
});
