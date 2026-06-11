/**
 * @module vcs/validateStateDirOverlap.test
 * Tests for stateDir/watch path overlap validation.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateStateDirOverlap } from './validateStateDirOverlap';

// Use resolve() to construct platform-appropriate absolute paths.
const base = resolve('/testdata');
const state = resolve(base, 'state');
const content = resolve(base, 'content');
const docs = resolve(base, 'docs');
const other = resolve(base, 'other');
const nested = resolve(state, 'nested');
const contentState = resolve(content, 'state');

describe('validateStateDirOverlap', () => {
  it('allows sibling directories (no overlap)', () => {
    expect(() => {
      validateStateDirOverlap(state, [content, docs]);
    }).not.toThrow();
  });

  it('allows completely unrelated paths', () => {
    expect(() => {
      validateStateDirOverlap(resolve('/var/state'), [
        resolve('/home/user/docs'),
      ]);
    }).not.toThrow();
  });

  it('throws when stateDir equals a watch path', () => {
    expect(() => {
      validateStateDirOverlap(content, [content]);
    }).toThrow(/same as watch path/);
  });

  it('throws when stateDir is a parent of a watch path', () => {
    expect(() => {
      validateStateDirOverlap(base, [content]);
    }).toThrow(/inside stateDir/);
  });

  it('throws when stateDir is a child of a watch path', () => {
    expect(() => {
      validateStateDirOverlap(contentState, [content]);
    }).toThrow(/inside watch path/);
  });

  it('handles multiple watch paths', () => {
    expect(() => {
      validateStateDirOverlap(state, [docs, other]);
    }).not.toThrow();
  });

  it('throws on first overlapping path in the array', () => {
    expect(() => {
      validateStateDirOverlap(state, [docs, nested]);
    }).toThrow(/inside stateDir/);
  });
});
