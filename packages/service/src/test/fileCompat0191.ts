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
  ['C:\\Docs\\A.md', 0, 'e8769851-9954-511d-8ef7-03878dae29fd'],
  ['c:/docs/a.md', 1, '524e829d-c402-592b-9618-10ede66d87fd'],
  ['C:/Docs/A.md', undefined, '04bf0dc1-9708-5f13-94ec-932cb0f1f6e7'],
  ['/home/user/notes/readme.md', 0, 'a8888d96-6b25-5e78-9b54-e6be93a8a7ee'],
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
