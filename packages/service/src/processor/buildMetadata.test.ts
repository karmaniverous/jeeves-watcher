import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../extractors', () => ({
  extractText: vi.fn().mockResolvedValue({
    text: 'hello world',
    frontmatter: {},
    json: null,
  }),
}));

vi.mock('../rules', () => ({
  buildAttributes: vi.fn().mockReturnValue({
    filePath: '/test/file.md',
    ext: '.md',
    basename: 'file.md',
    dirname: '/test',
  }),
  applyRules: vi.fn().mockResolvedValue({
    metadata: { category: 'doc' },
    renderedContent: null,
    matchedRules: ['rule-1'],
  }),
}));

vi.mock('../metadata', () => ({
  readMetadata: vi.fn().mockResolvedValue(null),
}));

import { extractText } from '../extractors';
import { readMetadata } from '../metadata';
import { applyRules } from '../rules';
import { buildMergedMetadata } from './buildMetadata';

describe('buildMergedMetadata', () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), 'jw-bm-'));
    testFile = join(tmpDir, 'file.md');
    await writeFile(testFile, '# Hello\nworld');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns inferred metadata from rules', async () => {
    const result = await buildMergedMetadata({
      filePath: testFile,
      compiledRules: [],
      metadataDir: tmpDir,
    });

    expect(result.inferred).toEqual({ category: 'doc' });
    expect(result.matchedRules).toEqual(['rule-1']);
  });

  it('merges enrichment over inferred metadata', async () => {
    vi.mocked(readMetadata).mockResolvedValueOnce({
      category: 'override',
      extra: 'yes',
    });

    const result = await buildMergedMetadata({
      filePath: testFile,
      compiledRules: [],
      metadataDir: tmpDir,
    });

    expect(result.metadata).toEqual({
      category: 'override',
      extra: 'yes',
    });
    expect(result.enrichment).toEqual({ category: 'override', extra: 'yes' });
  });

  it('handles null enrichment gracefully', async () => {
    vi.mocked(readMetadata).mockResolvedValueOnce(null);

    const result = await buildMergedMetadata({
      filePath: testFile,
      compiledRules: [],
      metadataDir: tmpDir,
    });

    expect(result.enrichment).toBeNull();
    expect(result.metadata).toEqual({ category: 'doc' });
  });

  it('passes options through to applyRules', async () => {
    const logger = { info: vi.fn() } as unknown as Parameters<
      typeof buildMergedMetadata
    >[0]['logger'];

    await buildMergedMetadata({
      filePath: testFile,
      compiledRules: [],
      metadataDir: tmpDir,
      logger,
    });

    expect(applyRules).toHaveBeenCalledWith(
      [],
      expect.anything(),
      expect.objectContaining({ logger }),
    );
  });

  it('includes extracted text in result', async () => {
    const result = await buildMergedMetadata({
      filePath: testFile,
      compiledRules: [],
      metadataDir: tmpDir,
    });

    expect(result.extracted).toEqual({
      text: 'hello world',
      frontmatter: {},
      json: null,
    });
    expect(extractText).toHaveBeenCalled();
  });
});
