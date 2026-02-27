import { describe, expect, it } from 'vitest';

import { computeLineOffsets } from './lineOffsets';

describe('computeLineOffsets', () => {
  it('returns empty array for empty text', () => {
    expect(computeLineOffsets('', ['chunk'])).toEqual([]);
  });

  it('returns empty array for empty chunks', () => {
    expect(computeLineOffsets('hello\nworld', [])).toEqual([]);
  });

  it('single chunk covering entire text', () => {
    const text = 'line1\nline2\nline3';
    expect(computeLineOffsets(text, [text])).toEqual([
      { lineStart: 1, lineEnd: 3 },
    ]);
  });

  it('single-line text', () => {
    const text = 'no newlines here';
    expect(computeLineOffsets(text, [text])).toEqual([
      { lineStart: 1, lineEnd: 1 },
    ]);
  });

  it('multiple chunks with no overlap', () => {
    const text = 'aaa\nbbb\nccc\nddd';
    const chunks = ['aaa\nbbb', 'ccc\nddd'];
    expect(computeLineOffsets(text, chunks)).toEqual([
      { lineStart: 1, lineEnd: 2 },
      { lineStart: 3, lineEnd: 4 },
    ]);
  });

  it('multiple chunks with overlap', () => {
    // Simulate overlap: chunk2 starts partway through chunk1's range
    const text = 'line1\nline2\nline3\nline4\nline5';
    const chunk1 = 'line1\nline2\nline3';
    const chunk2 = 'line2\nline3\nline4';
    const chunk3 = 'line3\nline4\nline5';
    expect(computeLineOffsets(text, [chunk1, chunk2, chunk3])).toEqual([
      { lineStart: 1, lineEnd: 3 },
      { lineStart: 2, lineEnd: 4 },
      { lineStart: 3, lineEnd: 5 },
    ]);
  });

  it('chunk that starts mid-line', () => {
    const text = 'hello world\nsecond line';
    const chunk = 'world\nsecond line';
    expect(computeLineOffsets(text, [chunk])).toEqual([
      { lineStart: 1, lineEnd: 2 },
    ]);
  });

  it('text with varying line lengths', () => {
    const text = 'a\nbb\nccc\ndddd\neeeee';
    const chunks = ['a\nbb\nccc', 'dddd\neeeee'];
    expect(computeLineOffsets(text, chunks)).toEqual([
      { lineStart: 1, lineEnd: 3 },
      { lineStart: 4, lineEnd: 5 },
    ]);
  });

  it('last chunk ending at EOF without trailing newline', () => {
    const text = 'first\nsecond\nthird';
    const chunks = ['first\nsecond', 'third'];
    expect(computeLineOffsets(text, chunks)).toEqual([
      { lineStart: 1, lineEnd: 2 },
      { lineStart: 3, lineEnd: 3 },
    ]);
  });

  it('handles chunk not found in text gracefully', () => {
    const text = 'hello\nworld';
    const chunks = ['hello', 'NOTFOUND', 'world'];
    const result = computeLineOffsets(text, chunks);
    expect(result).toHaveLength(3);
    // First chunk found normally
    expect(result[0]).toEqual({ lineStart: 1, lineEnd: 1 });
    // Not-found chunk gets fallback
    expect(result[1]).toBeDefined();
    // Third chunk still found
    expect(result[2]).toEqual({ lineStart: 2, lineEnd: 2 });
  });
});
