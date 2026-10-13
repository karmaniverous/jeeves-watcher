/**
 * @module api/handlers/pointsDelete.test
 * POST /points/delete: deletes the points a filter matches; a missing or non-object filter, or one Qdrant rejects, is 400 invalid_request with nothing deleted.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { PointsDeleteDeps } from './pointsDelete';
import { createPointsDeleteHandler } from './pointsDelete';

const logger = pino({ level: 'silent' });

/** An async generator over the given points. */
async function* points(list: { id: string }[]) {
  await Promise.resolve();
  for (const p of list) yield { ...p, payload: {} };
}

/** An async iterable failing like a Qdrant 400 on the first page. */
function rejected(): AsyncIterable<{ id: string }> {
  const error = Object.assign(new Error('Bad Request'), {
    status: 400,
    data: { status: { error: 'Format error in JSON body' } },
  });
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  };
}

/** Invoke the handler; return status (if set), body and the delete mock. */
async function invoke(scroll: () => AsyncIterable<unknown>, body: unknown) {
  const deleteMock = vi.fn();
  const deps: PointsDeleteDeps = {
    vectorStore: { scroll: vi.fn(scroll), delete: deleteMock } as never,
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
  };
}

const FILTER = { must: [{ key: 'domain', match: { value: 'memory' } }] };

describe('createPointsDeleteHandler', () => {
  it('deletes matching points', async () => {
    const res = await invoke(() => points([{ id: 'p1' }, { id: 'p2' }]), {
      filter: FILTER,
    });
    expect(res.deleteMock).toHaveBeenCalledWith(['p1', 'p2']);
    expect(res.body).toEqual({ deleted: 2 });
  });

  it('handles no matching points', async () => {
    const res = await invoke(() => points([]), { filter: { must: [] } });
    expect(res.deleteMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({ deleted: 0 });
  });

  it.each([
    ['a missing filter', {}],
    ['no body', undefined],
    ['a non-object filter', { filter: 'x' }],
    ['an array filter', { filter: [] }],
  ])('rejects %s with 400 invalid_request', async (_label, body) => {
    const res = await invoke(() => points([{ id: 'p1' }]), body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
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
