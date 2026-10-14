/**
 * @module api/handlers/pointsDelete.test
 * POST /points/delete: deletes the points a filter matches; a missing or non-object filter, or one Qdrant rejects, is 400 invalid_request with nothing deleted.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { PointsDeleteDeps } from './pointsDelete';
import { createPointsDeleteHandler } from './pointsDelete';

const logger = pino({ level: 'silent' });

type ScrollPage = (filter: unknown) => Promise<{
  points: { id: string; payload: object }[];
  nextCursor?: string;
}>;

/** A one-page scroll over the given point ids. */
const page =
  (ids: string[]): ScrollPage =>
  () =>
    Promise.resolve({ points: ids.map((id) => ({ id, payload: {} })) });

/** A scroll failing like a Qdrant 400 on the first page. */
const rejected: ScrollPage = () =>
  Promise.reject(
    Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { status: { error: 'Format error in JSON body' } },
    }),
  );

/** Invoke the handler; return status (if set), body and the mocks. */
async function invoke(scrollPage: ScrollPage, body: unknown) {
  const deleteMock = vi.fn();
  const scrollMock = vi.fn(scrollPage);
  const deps: PointsDeleteDeps = {
    vectorStore: { scrollPage: scrollMock, delete: deleteMock } as never,
    logger,
  };
  const status = vi.fn().mockReturnThis();
  const send = vi.fn();
  await createPointsDeleteHandler(deps)(
    { body } as never,
    { status, send } as never,
  );
  return {
    status: status.mock.calls[0]?.[0] as number | undefined,
    body: send.mock.calls[0]?.[0] as Record<string, unknown>,
    deleteMock,
    scrollMock,
  };
}

const FILTER = { must: [{ key: 'domain', match: { value: 'memory' } }] };

describe('createPointsDeleteHandler', () => {
  it('deletes matching points, scrolling with the given filter', async () => {
    const res = await invoke(page(['p1', 'p2']), { filter: FILTER });
    expect(res.scrollMock.mock.calls[0][0]).toEqual(FILTER);
    expect(res.deleteMock).toHaveBeenCalledWith(['p1', 'p2']);
    expect(res.body).toEqual({ deleted: 2 });
  });

  it('handles no matching points', async () => {
    const res = await invoke(page([]), { filter: { must: [] } });
    expect(res.deleteMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({ deleted: 0 });
  });

  it.each([
    ['a missing filter', {}],
    ['no body', undefined],
    ['a non-object filter', { filter: 'x' }],
    ['an array filter', { filter: [] }],
  ])('rejects %s with 400 invalid_request', async (_label, body) => {
    const res = await invoke(page(['p1']), body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      error: 'Missing required field: filter (object)',
    });
    expect(res.deleteMock).not.toHaveBeenCalled();
  });

  it('maps a Qdrant filter rejection to 400 invalid_request', async () => {
    const res = await invoke(rejected, { filter: { must: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'invalid_request',
      error: 'Invalid filter',
      message: 'Format error in JSON body',
    });
    expect(res.deleteMock).not.toHaveBeenCalled();
  });
});
