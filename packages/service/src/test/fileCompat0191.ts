/**
 * @module test/fileCompat0191
 * Fixture: what jeeves-watcher 0.19.1 writes for file points — point-ID namespace and key derivation, golden IDs, and the exact payload keys, chunking and hash for a sample rule-matched file. No I/O.
 * Every value was produced by running the published `@karmaniverous/jeeves-watcher@0.19.1` (DocumentProcessor, mock embeddings, chunkSize 250, overlap 0, one rule projecting `domain`) on {@link SAMPLE_0191}.
 */

/**
 * UUIDv5 namespace of 0.19.1 `pointId` (`packages/service/src/pointId/index.ts`
 * at tag `service/0.19.1`).
 */
export const NAMESPACE_0191 = '6a6f686e-6761-4c74-ad6a-656576657321';

/**
 * 0.19.1 point-ID key: slashes forward, lower-cased, `#<chunk>` suffix.
 *
 * @param filePath - File path as watched.
 * @param chunk - Chunk index.
 * @returns The UUIDv5 name 0.19.1 hashes.
 */
export function idKey0191(filePath: string, chunk: number): string {
  return `${filePath.replace(/\\/g, '/').toLowerCase()}#${String(chunk)}`;
}

/** Golden `[path, chunk, id]` triples computed with the 0.19.1 algorithm. */
export const GOLDEN_IDS_0191: ReadonlyArray<
  readonly [string, number | undefined, string]
> = [
  ['J:\\Docs\\A.md', 0, 'a5ebc023-6e3b-55a3-8403-a58e69dd7d16'],
  ['j:/docs/a.md', 1, 'd213a69e-0e0f-5164-8bc8-e7f18251a424'],
  ['J:/Docs/A.md', undefined, '7dc9f1e3-a0b6-5fff-92ef-7d4d12b55314'],
  ['/home/jeeves/notes/readme.md', 0, '2ff3c683-0b72-5336-8747-8a09a94696ca'],
  ['C:\\Users\\X\\My File.txt', 3, '72b32538-4b69-5ec4-b566-4eafcde9e1e3'],
];

/**
 * Payload keys 0.19.1 writes on every chunk of a file matched by one rule
 * projecting `domain`: rule metadata, `matched_rules`, then the pipeline's
 * system fields (`processingPipeline.ts` at `service/0.19.1`). No `source`
 * or `source_rule`.
 */
export const FILE_PAYLOAD_KEYS_0191: readonly string[] = [
  'chunk_index',
  'chunk_text',
  'content_hash',
  'created_at',
  'domain',
  'file_path',
  'line_end',
  'line_start',
  'matched_rules',
  'modified_at',
  'total_chunks',
];

/** The sample Markdown file processed by 0.19.1. */
export const SAMPLE_0191 = `# Guide\n\n${[1, 2, 3, 4]
  .map(
    (i) =>
      `## Section ${String(i)}\n\n${'Utilisation below thirty percent helps. '.repeat(4)}`,
  )
  .join('\n\n')}\n`;

/** `content_hash` 0.19.1 stores on every chunk of {@link SAMPLE_0191}. */
export const SAMPLE_HASH_0191 =
  '0256fd5bd23a3f030057311f7f377c10ea652f1ccb916671386c0dbd28336519';

/** `[line_start, line_end]` per chunk of {@link SAMPLE_0191} in 0.19.1. */
export const SAMPLE_LINES_0191: ReadonlyArray<readonly [number, number]> = [
  [1, 5],
  [7, 9],
  [11, 13],
  [15, 17],
];
