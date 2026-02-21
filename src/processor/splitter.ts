/**
 * @module splitter
 *
 * Text splitter factory for different file types.
 */

import {
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
} from '@langchain/textsplitters';

/**
 * Create the appropriate text splitter for the given file extension.
 *
 * @param ext - File extension (including leading dot).
 * @param chunkSize - Maximum chunk size in characters.
 * @param chunkOverlap - Overlap between chunks in characters.
 * @returns A text splitter instance.
 */
export function createSplitter(
  ext: string,
  chunkSize: number,
  chunkOverlap: number,
): MarkdownTextSplitter | RecursiveCharacterTextSplitter {
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.md' || lowerExt === '.markdown') {
    return new MarkdownTextSplitter({ chunkSize, chunkOverlap });
  }
  return new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
}
