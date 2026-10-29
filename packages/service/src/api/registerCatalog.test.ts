/**
 * @module api/registerCatalog.test
 * The pure parts of the catalog registration: the validation-error body and the `POST /config/apply` body normalisation (deprecated `{ config }` alias, absent body or patch).
 */

import type { CatalogValidationIssue } from '@karmaniverous/jeeves/fastify';
import { describe, expect, it } from 'vitest';

import {
  formatValidationError,
  normalizeConfigApplyBody,
} from './registerCatalog';

const issue = (message: string): CatalogValidationIssue => ({
  slot: 'body',
  path: ['patch'],
  code: 'invalid_type',
  message,
  params: { expected: 'record' },
});

describe('formatValidationError', () => {
  it('uses the first issue as the error and lists them all', () => {
    const issues = [issue('first'), issue('second')];
    expect(formatValidationError(issues)).toEqual({
      code: 'invalid_request',
      error: 'first',
      details: issues,
    });
  });

  it('falls back to a generic message for an empty issue list', () => {
    expect(formatValidationError([])).toEqual({
      code: 'invalid_request',
      error: 'Invalid request',
      details: [],
    });
  });
});

describe('normalizeConfigApplyBody', () => {
  it.each([
    ['an absent body', undefined, { patch: {} }],
    ['a null body', null, { patch: {} }],
    ['an empty object', {}, { patch: {} }],
    ['a patch', { patch: { a: 1 } }, { patch: { a: 1 } }],
    ['the config alias', { config: { a: 1 } }, { patch: { a: 1 } }],
    [
      'a patch over the alias',
      { patch: { a: 1 }, config: { b: 2 } },
      { patch: { a: 1 } },
    ],
    [
      'replace alongside the alias',
      { config: { a: 1 }, replace: true },
      { patch: { a: 1 }, replace: true },
    ],
    ['an unknown key', { other: 1 }, { other: 1, patch: {} }],
  ])('normalises %s', (_label, body, expected) => {
    expect(normalizeConfigApplyBody(body)).toEqual(expected);
  });

  it.each([
    ['an array', [1]],
    ['a string', 'nope'],
    ['a number', 7],
  ])('leaves %s for the schema to reject', (_label, body) => {
    expect(normalizeConfigApplyBody(body)).toBe(body);
  });

  it('keeps a non-object patch for the schema to reject', () => {
    expect(normalizeConfigApplyBody({ patch: [] })).toEqual({ patch: [] });
  });
});
