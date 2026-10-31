/**
 * @module api/catalog/notFoundBody.test
 * `notFoundBody` reproduces today's Fastify not-found body exactly
 * (`apiHooks`' `setNotFoundHandler`), for every method/URL combination.
 */

import { describe, expect, it } from 'vitest';

import { notFoundBody } from './notFoundBody';

describe('notFoundBody', () => {
  it('builds the not_found body for a plain route', () => {
    expect(notFoundBody('GET', '/vcs/show')).toEqual({
      code: 'not_found',
      error: 'Not Found',
      message: 'Route GET:/vcs/show not found',
    });
  });

  it('keeps the query string in the message', () => {
    expect(
      notFoundBody('GET', '/vcs/show?path=/root/notes.md&commit=abc123'),
    ).toEqual({
      code: 'not_found',
      error: 'Not Found',
      message:
        'Route GET:/vcs/show?path=/root/notes.md&commit=abc123 not found',
    });
  });

  it('reflects the given method', () => {
    expect(notFoundBody('POST', '/vcs/show')).toEqual({
      code: 'not_found',
      error: 'Not Found',
      message: 'Route POST:/vcs/show not found',
    });
  });
});
