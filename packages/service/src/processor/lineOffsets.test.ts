/**
 * @module processor/lineOffsets.test
 * Tests for line offset computation.
 */

import { describe, expect, it } from 'vitest';

import { computeLineOffsets } from './lineOffsets';

describe('computeLineOffsets', () => {
  it('should compute offsets for single-line chunks', () => {
    const text = 'line 1\nline 2\nline 3';
    const chunks = ['line 1', 'line 2', 'line 3'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([
      { lineStart: 1, lineEnd: 1 },
      { lineStart: 2, lineEnd: 2 },
      { lineStart: 3, lineEnd: 3 },
    ]);
  });

  it('should compute offsets for multi-line chunks', () => {
    const text = 'line 1\nline 2\nline 3\nline 4';
    const chunks = ['line 1\nline 2', 'line 3\nline 4'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([
      { lineStart: 1, lineEnd: 2 },
      { lineStart: 3, lineEnd: 4 },
    ]);
  });

  it('should handle overlapping chunks', () => {
    const text = 'line 1\nline 2\nline 3';
    const chunks = ['line 1\nline 2', 'line 2\nline 3'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([
      { lineStart: 1, lineEnd: 2 },
      { lineStart: 2, lineEnd: 3 },
    ]);
  });

  it('should handle chunks not found in source', () => {
    const text = 'line 1\nline 2';
    const chunks = ['line 1', 'missing chunk'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([
      { lineStart: 1, lineEnd: 1 },
      { lineStart: 0, lineEnd: 0 },
    ]);
  });

  it('should handle empty chunks array', () => {
    const text = 'line 1\nline 2';
    const chunks: string[] = [];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([]);
  });

  it('should handle empty text', () => {
    const text = '';
    const chunks = [''];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([{ lineStart: 1, lineEnd: 1 }]);
  });

  it('should handle chunks with trailing newlines', () => {
    const text = 'line 1\n\nline 2\n';
    const chunks = ['line 1\n', 'line 2\n'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([
      { lineStart: 1, lineEnd: 2 },
      { lineStart: 3, lineEnd: 4 },
    ]);
  });

  it('should compute line end correctly for chunks with multiple newlines', () => {
    const text = 'a\nb\nc\nd';
    const chunks = ['a\nb\nc'];
    const result = computeLineOffsets(text, chunks);

    expect(result).toEqual([{ lineStart: 1, lineEnd: 3 }]);
  });
});
