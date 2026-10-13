/**
 * @module sources/sourceUrl.test
 * Tests for reference parsing, segment encoding and URL building: encoding of spaces/unicode/%/?/#, rejected ids, origin checks.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSourceUrl,
  encodeSourceId,
  parseSourceReference,
  templateOrigin,
} from './sourceUrl';
import { SourceReferenceError } from './types';

function rejection(fn: () => unknown): SourceReferenceError {
  try {
    fn();
  } catch (err) {
    if (err instanceof SourceReferenceError) return err;
    throw err;
  }
  throw new Error('expected a SourceReferenceError');
}

describe('parseSourceReference', () => {
  it('splits name and id at the first ://', () => {
    expect(parseSourceReference('app://chat/thread/a://b')).toEqual({
      ref: 'app://chat/thread/a://b',
      name: 'app',
      id: 'chat/thread/a://b',
    });
  });

  it.each([
    'app:chat',
    'c://x',
    'APP://x',
    'app://',
    'app://a b',
    'c:/path',
    `app://${'x'.repeat(513)}`,
  ])('rejects %j as invalid_reference', (ref) => {
    expect(rejection(() => parseSourceReference(ref)).code).toBe(
      'invalid_reference',
    );
  });
});

describe('encodeSourceId', () => {
  it.each([
    ['chat/thread/1', 'chat/thread/1'],
    ['a b/c', 'a%20b/c'],
    ['caf\u00e9/\u{1F600}', 'caf%C3%A9/%F0%9F%98%80'],
    ['100%/x', '100%25/x'],
    ['q?x=1', 'q%3Fx%3D1'],
    ['frag#top', 'frag%23top'],
    ['%2e%2e', '%252e%252e'],
    ['a\\b', 'a%5Cb'],
    ['a&b=c:d@e', 'a%26b%3Dc%3Ad%40e'],
    ['...', '...'],
  ])('encodes %j as %j, keeping slashes', (id, expected) => {
    expect(encodeSourceId(id)).toBe(expected);
  });

  it.each(['/a', 'a/', 'a//b', '.', '..', 'a/../b', 'a/./b', '../etc'])(
    'rejects %j as invalid_id',
    (id) => {
      expect(rejection(() => encodeSourceId(id)).code).toBe('invalid_id');
    },
  );
});

describe('templateOrigin', () => {
  it('returns the fixed origin of an http(s) template', () => {
    expect(templateOrigin('https://ai.example.com:8443/t/{id}?x=1')).toBe(
      'https://ai.example.com:8443',
    );
    expect(templateOrigin('http://127.0.0.1/get?id={id}')).toBe(
      'http://127.0.0.1',
    );
  });

  it.each([
    'http://{id}.example.com/x',
    'http://example.com:{id}/x',
    'file:///etc/{id}',
    'ftp://example.com/{id}',
    'not a url {id}',
    '/relative/{id}',
  ])('rejects %j', (template) => {
    expect(templateOrigin(template)).toBeUndefined();
  });
});

describe('buildSourceUrl', () => {
  const template = 'http://127.0.0.1:9/threads/{id}?v=1';
  const origin = 'http://127.0.0.1:9';

  it('substitutes the encoded id into every placeholder', () => {
    expect(buildSourceUrl(template, origin, 'chat/a b')).toBe(
      'http://127.0.0.1:9/threads/chat/a%20b?v=1',
    );
    expect(buildSourceUrl('http://h/{id}/{id}', 'http://h', 'x/y')).toBe(
      'http://h/x/y/x/y',
    );
  });

  it('rejects ids with invalid segments', () => {
    expect(
      rejection(() => buildSourceUrl(template, origin, 'a/../b')).code,
    ).toBe('invalid_id');
  });

  it('rejects a result outside the expected origin', () => {
    expect(
      rejection(() => buildSourceUrl(template, 'http://other', 'a')).code,
    ).toBe('invalid_id');
  });

  it('rejects a template that does not build a URL (defensive: config validates templates)', () => {
    const error = rejection(() =>
      buildSourceUrl('http://[bad/{id}', 'http://h', 'a'),
    );
    expect(error.code).toBe('invalid_id');
    expect(error.message).toBe('Source id yields an invalid URL');
  });
});
