/**
 * @module cli/jeeves-watcher/metadataArgs.test
 * parseMetadataArgs: --json then --key pairs (keys win, values split at the first `=`); invalid JSON, a pair without `=` and empty metadata are reported on stderr with exit code 1 and return null.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { parseMetadataArgs } from './metadataArgs';

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  errorSpy.mockRestore();
  process.exitCode = undefined;
});

describe('parseMetadataArgs', () => {
  it('merges --key pairs over --json, splitting at the first =', () => {
    expect(
      parseMetadataArgs('{"title":"a","tags":["x"]}', ['title=b', 'q=1=2']),
    ).toEqual({ title: 'b', tags: ['x'], q: '1=2' });
    expect(process.exitCode).toBeUndefined();
  });

  it('accepts --key pairs alone', () => {
    expect(parseMetadataArgs(undefined, ['k=v'])).toEqual({ k: 'v' });
  });

  it.each([
    ['invalid JSON', '{nope', [], 'Invalid JSON:'],
    [
      'a pair without =',
      undefined,
      ['novalue'],
      'Invalid key-value pair: novalue',
    ],
    [
      'no metadata',
      undefined,
      [],
      'No metadata provided. Use --key or --json.',
    ],
    [
      'an empty JSON object',
      '{}',
      [],
      'No metadata provided. Use --key or --json.',
    ],
  ])('rejects %s', (_label, json, keys, message) => {
    expect(parseMetadataArgs(json, keys)).toBeNull();
    expect(errorSpy.mock.calls[0]?.[0]).toBe(message);
    expect(process.exitCode).toBe(1);
  });
});
