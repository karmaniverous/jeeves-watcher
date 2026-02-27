/**
 * @module processor/lineOffsets
 * Compute 1-indexed line ranges for chunks within source text.
 */

/**
 * Compute 1-indexed line start and end for each chunk within the source text.
 *
 * @param fullText - The complete source text.
 * @param chunks - Array of chunk strings extracted from fullText.
 * @returns Array of `{ lineStart, lineEnd }` for each chunk.
 */
export function computeLineOffsets(
  fullText: string,
  chunks: string[],
): Array<{ lineStart: number; lineEnd: number }> {
  if (!fullText || chunks.length === 0) return [];

  // Build cumulative line-start character offsets
  const lineStarts = [0];
  for (let i = 0; i < fullText.length; i++) {
    if (fullText[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  /** Map a character offset to a 1-indexed line number. */
  function offsetToLine(offset: number): number {
    // Binary search for the largest lineStart <= offset
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  }

  const results: Array<{ lineStart: number; lineEnd: number }> = [];
  let searchFrom = 0;

  for (const chunk of chunks) {
    const pos = fullText.indexOf(chunk, searchFrom);
    if (pos === -1) {
      // Chunk not found — fall back to searchFrom position
      results.push({
        lineStart: offsetToLine(searchFrom),
        lineEnd: offsetToLine(searchFrom),
      });
      continue;
    }

    const lineStart = offsetToLine(pos);
    const endPos = pos + chunk.length - 1;
    const lineEnd =
      chunk.length === 0 ? lineStart : offsetToLine(Math.max(pos, endPos));

    results.push({ lineStart, lineEnd });
    // Advance searchFrom past the START of this chunk (not end) to handle overlap
    searchFrom = pos + 1;
  }

  return results;
}
