/**
 * @module processor/ceilings.test
 * Processing ceilings (D44, D64): a value equal to its ceiling is allowed and one more is too_large, for file size (stat), extracted text bytes (UTF-8) and chunk count; a failed stat is left to the resolver.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chunkExcess, fileSizeExcess, textExcess } from './ceilings';

describe('fileSizeExcess', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-ceil-'));
    file = join(dir, 'ten.txt');
    await writeFile(file, '0123456789', 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('allows a file of exactly maxFileBytes', async () => {
    await expect(fileSizeExcess(file, 10)).resolves.toBeUndefined();
  });

  it('reports a file one byte over', async () => {
    await expect(fileSizeExcess(file, 9)).resolves.toBe(
      'File is 10 bytes, over processing.maxFileBytes (9)',
    );
  });

  it('leaves a missing file to the resolver', async () => {
    await expect(
      fileSizeExcess(join(dir, 'missing.txt'), 1),
    ).resolves.toBeUndefined();
  });
});

describe('textExcess', () => {
  it('counts UTF-8 bytes, not characters', () => {
    // 'é' is two bytes in UTF-8.
    expect(textExcess('éé', { maxTextBytes: 4 })).toBeUndefined();
    expect(textExcess('éé', { maxTextBytes: 3 })).toBe(
      'Extracted text is 4 bytes, over processing.maxTextBytes (3)',
    );
  });
});

describe('chunkExcess', () => {
  it('allows exactly maxChunksPerFile and reports one more', () => {
    expect(chunkExcess(5, { maxChunksPerFile: 5 })).toBeUndefined();
    expect(chunkExcess(6, { maxChunksPerFile: 5 })).toBe(
      'Document splits into 6 chunks, over processing.maxChunksPerFile (5)',
    );
  });
});
