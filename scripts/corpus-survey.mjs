/**
 * Corpus survey (B5a, D64): read a watcher collection, read-only, and report
 * the documents a set of `processing` ceilings would make `too_large`, plus
 * the chunks-per-document distribution the 0.21.0 defaults were derived from.
 *
 * Run it before upgrading to 0.21.0 (the defaults are 64 MiB of file,
 * 5000 chunks and 8 MiB of extracted text):
 *
 *   node scripts/corpus-survey.mjs --url http://localhost:6333 --collection jeeves_archive
 *     [--api-key <key>] [--max-file-bytes 64m] [--max-chunks 5000]
 *     [--max-text-bytes 8m] [--json <file>]
 *
 * It scrolls every point (payload only: `file_path`, `source`,
 * `chunk_index`, `total_chunks`, `chunk_text`; no vectors), groups them by
 * document, and `stat`s each file path for its size. The extracted-text size
 * is the sum of the chunks' UTF-8 bytes, an upper bound (chunk overlap is
 * counted twice), so a document flagged only on text bytes may in fact fit.
 * Nothing is written to Qdrant.
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

/** The 0.21.0 `processing` defaults. */
export const DEFAULT_CEILINGS = {
  maxFileBytes: '64m',
  maxChunks: 5000,
  maxTextBytes: '8m',
};

/** Chunk-count thresholds of the distribution. */
export const HISTOGRAM_THRESHOLDS = [200, 1000, 2000, 5000, 10000];

const UNITS = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/**
 * Parse a byte size: a number of bytes, or a string with a k, m or g suffix
 * (binary units), as the watcher config accepts.
 */
export function parseByteSize(value) {
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)([kmg]?)$/iu.exec(String(value));
  if (!match) throw new Error(`Invalid byte size: ${String(value)}`);
  return Math.floor(Number(match[1]) * UNITS[match[2].toLowerCase()]);
}

/** Create an empty survey accumulator. */
export function createSurvey() {
  return { points: 0, documents: new Map() };
}

/**
 * Add one scrolled point's payload to the survey. Points carrying neither
 * `file_path` nor `source` are counted but not grouped.
 */
export function addPoint(survey, payload) {
  survey.points++;
  const filePath =
    typeof payload.file_path === 'string' && payload.file_path !== ''
      ? payload.file_path
      : undefined;
  const source = typeof payload.source === 'string' ? payload.source : '';
  const key = filePath ?? (source === '' ? undefined : source);
  if (key === undefined) return;
  let doc = survey.documents.get(key);
  if (!doc) {
    doc = {
      key,
      kind: filePath ? 'file' : 'source',
      points: 0,
      totalChunks: undefined,
      textBytes: 0,
      fileBytes: undefined,
    };
    survey.documents.set(key, doc);
  }
  doc.points++;
  if (payload.chunk_index === 0 && typeof payload.total_chunks === 'number') {
    doc.totalChunks = payload.total_chunks;
  }
  if (typeof payload.chunk_text === 'string') {
    doc.textBytes += Buffer.byteLength(payload.chunk_text, 'utf8');
  }
}

/** A document's chunk count: chunk 0's `total_chunks`, else points seen. */
export function chunkCount(doc) {
  return doc.totalChunks ?? doc.points;
}

/**
 * Summarise a survey against ceilings (bytes and a chunk count): counts,
 * the distribution and every document over a ceiling, largest first.
 */
export function summarise(survey, ceilings) {
  const docs = [...survey.documents.values()];
  const counts = docs.map(chunkCount);
  const histogram = Object.fromEntries(
    HISTOGRAM_THRESHOLDS.map((t) => [
      `>=${String(t)}`,
      counts.filter((c) => c >= t).length,
    ]),
  );
  const over = docs
    .map((doc) => {
      const reasons = [];
      if (
        doc.fileBytes !== undefined &&
        doc.fileBytes > ceilings.maxFileBytes
      ) {
        reasons.push('maxFileBytes');
      }
      if (chunkCount(doc) > ceilings.maxChunks)
        reasons.push('maxChunksPerFile');
      if (doc.textBytes > ceilings.maxTextBytes) reasons.push('maxTextBytes');
      return { ...doc, chunks: chunkCount(doc), reasons };
    })
    .filter((doc) => doc.reasons.length > 0)
    .sort((a, b) => b.chunks - a.chunks);
  return {
    points: survey.points,
    documents: docs.length,
    files: docs.filter((d) => d.kind === 'file').length,
    sources: docs.filter((d) => d.kind === 'source').length,
    // A reduce, not Math.max(...counts): a large corpus overflows the stack.
    maxChunks: counts.reduce((max, c) => Math.max(max, c), 0),
    histogram,
    ceilings,
    over,
  };
}

/** Read `stat` sizes for the file documents (missing files stay unknown). */
export function statFiles(survey, statSync = fs.statSync) {
  for (const doc of survey.documents.values()) {
    if (doc.kind !== 'file') continue;
    try {
      doc.fileBytes = statSync(doc.key).size;
    } catch {
      doc.fileBytes = undefined;
    }
  }
}

/** Scroll every point of a collection into the survey (read-only). */
export async function scrollCollection(
  options,
  survey,
  fetchImpl = globalThis.fetch,
) {
  let offset;
  do {
    const response = await fetchImpl(
      `${options.url.replace(/\/$/u, '')}/collections/${encodeURIComponent(options.collection)}/points/scroll`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey ? { 'api-key': options.apiKey } : {}),
        },
        body: JSON.stringify({
          limit: options.pageSize ?? 1000,
          ...(offset === undefined ? {} : { offset }),
          with_payload: [
            'file_path',
            'source',
            'chunk_index',
            'total_chunks',
            'chunk_text',
          ],
          with_vector: false,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Qdrant scroll failed: HTTP ${String(response.status)}`);
    }
    const { result } = await response.json();
    for (const point of result.points) addPoint(survey, point.payload ?? {});
    offset = result.next_page_offset ?? undefined;
  } while (offset !== undefined);
}

/** Parse `--name value` options. */
export function parseArgs(argv) {
  const options = {
    url: 'http://localhost:6333',
    collection: undefined,
    apiKey: undefined,
    json: undefined,
    maxFileBytes: parseByteSize(DEFAULT_CEILINGS.maxFileBytes),
    maxChunks: DEFAULT_CEILINGS.maxChunks,
    maxTextBytes: parseByteSize(DEFAULT_CEILINGS.maxTextBytes),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/u, '');
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`Unknown or incomplete option: ${String(argv[i])}`);
    }
    switch (name) {
      case 'url':
        options.url = value;
        break;
      case 'collection':
        options.collection = value;
        break;
      case 'api-key':
        options.apiKey = value;
        break;
      case 'json':
        options.json = path.resolve(value);
        break;
      case 'max-file-bytes':
        options.maxFileBytes = parseByteSize(value);
        break;
      case 'max-text-bytes':
        options.maxTextBytes = parseByteSize(value);
        break;
      case 'max-chunks':
        options.maxChunks = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`Unknown or incomplete option: ${String(argv[i])}`);
    }
  }
  if (!options.collection) throw new Error('--collection is required');
  return options;
}

/** Human-readable report. */
export function formatReport(summary) {
  const lines = [
    `Points: ${String(summary.points)}; documents: ${String(summary.documents)} (${String(summary.files)} files, ${String(summary.sources)} source documents)`,
    `Largest document: ${String(summary.maxChunks)} chunks`,
    `Documents by chunk count: ${Object.entries(summary.histogram)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ')}`,
    `Ceilings: maxFileBytes ${String(summary.ceilings.maxFileBytes)}, maxChunksPerFile ${String(summary.ceilings.maxChunks)}, maxTextBytes ${String(summary.ceilings.maxTextBytes)} (text bytes are an upper bound)`,
    `Over a ceiling (would be too_large): ${String(summary.over.length)}`,
    ...summary.over.map(
      (d) =>
        `  ${d.key}: ${String(d.chunks)} chunks, ~${String(d.textBytes)} text bytes, ${d.fileBytes === undefined ? '?' : String(d.fileBytes)} file bytes [${d.reasons.join(', ')}]`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** CLI entry: 0 on success, 1 on error. */
async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const survey = createSurvey();
    await scrollCollection(options, survey);
    statFiles(survey);
    const summary = summarise(survey, {
      maxFileBytes: options.maxFileBytes,
      maxChunks: options.maxChunks,
      maxTextBytes: options.maxTextBytes,
    });
    process.stdout.write(formatReport(summary));
    if (options.json) {
      fs.writeFileSync(options.json, `${JSON.stringify(summary, null, 2)}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(
      `corpus-survey: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await main();
}
