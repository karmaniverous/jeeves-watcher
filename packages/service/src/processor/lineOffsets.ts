/**
 * @module processor/lineOffsets
 * Compute line offsets for text chunks within source text.
 */

/**
 * Line offset information for a chunk.
 */
export interface LineOffset {
  /** 1-indexed line number where the chunk begins. */
  lineStart: number;
  /** 1-indexed line number where the chunk ends. */
  lineEnd: number;
}

/**
 * Compute line offsets for each chunk within the source text.
 *
 * Handles overlapping chunks by searching from the previous chunk's start position.
 *
 * @param text - The source text.
 * @param chunks - The array of text chunks.
 * @returns Array of line offset information for each chunk.
 */
export function computeLineOffsets(
  text: string,
  chunks: string[],
): LineOffset[] {
  const offsets: LineOffset[] = [];
  let searchFrom = 0;

  for (const chunk of chunks) {
    const pos = text.indexOf(chunk, searchFrom);
    if (pos === -1) {
      // Fallback: can't find chunk in source (shouldn't happen, but be safe)
      offsets.push({ lineStart: 0, lineEnd: 0 });
      continue;
    }

    const lineStart = text.slice(0, pos).split('\n').length;
    const linesInChunk = chunk.split('\n').length - 1;
    const lineEnd = lineStart + linesInChunk;

    offsets.push({ lineStart, lineEnd });
    searchFrom = pos; // Next chunk starts searching from here (handles overlap)
  }

  return offsets;
}
