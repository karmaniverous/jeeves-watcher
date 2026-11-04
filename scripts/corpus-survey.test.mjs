/**
 * Tests for the corpus survey (`corpus-survey.mjs`), run with `node --test`.
 * In-memory payloads and a fake fetch: no Qdrant.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addPoint,
  chunkCount,
  createSurvey,
  formatReport,
  parseArgs,
  parseByteSize,
  scrollCollection,
  statFiles,
  summarise,
} from './corpus-survey.mjs';

const CEILINGS = { maxFileBytes: 100, maxChunks: 3, maxTextBytes: 10 };

describe('parseByteSize', () => {
  it('reads numbers and binary-suffixed strings', () => {
    assert.equal(parseByteSize(5), 5);
    assert.equal(parseByteSize('2k'), 2048);
    assert.equal(parseByteSize('64m'), 64 * 1024 ** 2);
    assert.equal(parseByteSize('1.5G'), Math.floor(1.5 * 1024 ** 3));
    assert.throws(() => parseByteSize('64x'), /Invalid byte size/u);
  });
});

describe('survey aggregation', () => {
  it('groups points by file path or source and counts chunks and text bytes', () => {
    const survey = createSurvey();
    addPoint(survey, {
      file_path: 'a.md',
      chunk_index: 0,
      total_chunks: 2,
      chunk_text: 'abc',
    });
    addPoint(survey, {
      file_path: 'a.md',
      chunk_index: 1,
      total_chunks: 2,
      chunk_text: 'é',
    });
    addPoint(survey, { source: 'app://1', chunk_index: 1, chunk_text: 'x' });
    addPoint(survey, { other: true });
    assert.equal(survey.points, 4);
    const a = survey.documents.get('a.md');
    assert.equal(a.kind, 'file');
    assert.equal(chunkCount(a), 2);
    assert.equal(a.textBytes, 5);
    const s = survey.documents.get('app://1');
    assert.equal(s.kind, 'source');
    // No chunk 0 seen: the points seen.
    assert.equal(chunkCount(s), 1);
  });

  it('flags every document over a ceiling, largest first', () => {
    const survey = createSurvey();
    addPoint(survey, { file_path: 'big.md', chunk_index: 0, total_chunks: 4 });
    addPoint(survey, {
      file_path: 'wordy.md',
      chunk_index: 0,
      total_chunks: 1,
      chunk_text: 'x'.repeat(11),
    });
    addPoint(survey, {
      file_path: 'heavy.md',
      chunk_index: 0,
      total_chunks: 3,
      chunk_text: 'y',
    });
    addPoint(survey, {
      file_path: 'ok.md',
      chunk_index: 0,
      total_chunks: 3,
      chunk_text: 'y',
    });
    statFiles(survey, (file) => {
      if (file === 'heavy.md') return { size: 101 };
      if (file === 'ok.md') return { size: 100 };
      throw new Error('ENOENT');
    });
    const summary = summarise(survey, CEILINGS);
    assert.equal(summary.documents, 4);
    assert.equal(summary.files, 4);
    assert.equal(summary.maxChunks, 4);
    assert.deepEqual(
      summary.over.map((d) => [d.key, d.reasons]),
      [
        ['big.md', ['maxChunksPerFile']],
        ['heavy.md', ['maxFileBytes']],
        ['wordy.md', ['maxTextBytes']],
      ],
    );
    assert.equal(summary.histogram['>=200'], 0);
    const report = formatReport(summary);
    assert.match(report, /Over a ceiling \(would be too_large\): 3/u);
    assert.match(report, /big\.md: 4 chunks/u);
    assert.match(report, /wordy\.md: 1 chunks, ~11 text bytes, \? file bytes/u);
  });

  it('builds the chunk-count distribution', () => {
    const survey = createSurvey();
    for (const [i, n] of [150, 250, 1200, 6000].entries()) {
      addPoint(survey, {
        file_path: `${String(i)}.md`,
        chunk_index: 0,
        total_chunks: n,
      });
    }
    const { histogram } = summarise(survey, CEILINGS);
    assert.deepEqual(histogram, {
      '>=200': 3,
      '>=1000': 2,
      '>=2000': 1,
      '>=5000': 1,
      '>=10000': 0,
    });
  });

  it('handles a corpus too large to spread into Math.max', () => {
    const survey = createSurvey();
    for (let i = 0; i < 200_000; i++) {
      addPoint(survey, {
        file_path: `f${String(i)}`,
        chunk_index: 0,
        total_chunks: i % 7,
      });
    }
    assert.equal(summarise(survey, CEILINGS).maxChunks, 6);
  });

  it('reports an empty collection', () => {
    const summary = summarise(createSurvey(), CEILINGS);
    assert.equal(summary.maxChunks, 0);
    assert.deepEqual(summary.over, []);
  });
});

describe('scrollCollection', () => {
  it('pages through the collection read-only, payload only', async () => {
    const bodies = [];
    const pages = [
      {
        points: [
          { payload: { file_path: 'a.md', chunk_index: 0, total_chunks: 1 } },
        ],
        next_page_offset: 'p2',
      },
      {
        points: [{ payload: { source: 'app://1' } }, { payload: null }],
        next_page_offset: null,
      },
    ];
    const fetchImpl = (url, init) => {
      bodies.push({ url, init, body: JSON.parse(init.body) });
      const result = pages.shift();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result }),
      });
    };
    const survey = createSurvey();
    await scrollCollection(
      { url: 'http://q:6333/', collection: 'c', apiKey: 'k', pageSize: 2 },
      survey,
      fetchImpl,
    );
    assert.equal(survey.points, 3);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].url, 'http://q:6333/collections/c/points/scroll');
    assert.equal(bodies[0].init.method, 'POST');
    assert.equal(bodies[0].init.headers['api-key'], 'k');
    assert.equal(bodies[0].body.with_vector, false);
    assert.equal(bodies[0].body.limit, 2);
    assert.equal(bodies[0].body.offset, undefined);
    assert.equal(bodies[1].body.offset, 'p2');
  });

  it('throws on an HTTP error', async () => {
    await assert.rejects(
      scrollCollection(
        { url: 'http://q', collection: 'c' },
        createSurvey(),
        () => Promise.resolve({ ok: false, status: 404 }),
      ),
      /HTTP 404/u,
    );
  });
});

describe('parseArgs', () => {
  it('reads every option, defaults the ceilings, and requires a collection', () => {
    const options = parseArgs([
      '--url',
      'http://q',
      '--collection',
      'c',
      '--api-key',
      'k',
      '--max-file-bytes',
      '1k',
      '--max-chunks',
      '7',
      '--max-text-bytes',
      '2k',
      '--json',
      'out.json',
    ]);
    assert.equal(options.url, 'http://q');
    assert.equal(options.collection, 'c');
    assert.equal(options.apiKey, 'k');
    assert.equal(options.maxFileBytes, 1024);
    assert.equal(options.maxChunks, 7);
    assert.equal(options.maxTextBytes, 2048);
    assert.match(options.json, /out\.json$/u);
    const defaults = parseArgs(['--collection', 'c']);
    assert.equal(defaults.maxFileBytes, 64 * 1024 ** 2);
    assert.equal(defaults.maxChunks, 5000);
    assert.equal(defaults.maxTextBytes, 8 * 1024 ** 2);
    assert.throws(() => parseArgs([]), /--collection is required/u);
    assert.throws(() => parseArgs(['--bogus', 'x']), /Unknown/u);
    assert.throws(() => parseArgs(['--url']), /incomplete/u);
  });
});
