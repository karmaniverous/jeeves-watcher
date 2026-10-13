/**
 * @module processor/renderFile.test
 * DocumentProcessor.renderFile on real temp files: extracted text passes through with the file extension as renderAs (`txt` without one); a rule template's output is returned with the rule's renderAs; nothing is embedded or written.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { compileRules } from '../rules';
import { createHandlebarsInstance, TemplateEngine } from '../templates';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';

const embed = vi.fn();
const upsert = vi.fn();

function makeProcessor() {
  const templateEngine = new TemplateEngine(createHandlebarsInstance());
  templateEngine.compile('json-page', '# {{file.filename}}');
  return new DocumentProcessor({
    config: {},
    embeddingProvider: { dimensions: 1, embed },
    vectorStore: { upsert } as unknown as VectorStoreClient,
    compiledRules: compileRules([
      {
        name: 'json-page',
        description: 'JSON page',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: { extension: { const: '.json' } },
            },
          },
        },
        template: 'json-page',
        renderAs: 'html',
      },
    ]),
    logger: pino({ level: 'silent' }),
    templateEngine,
  });
}

describe('DocumentProcessor.renderFile', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jw-render-'));
    await writeFile(join(dir, 'a.md'), 'hello world');
    await writeFile(join(dir, 'README'), 'plain text');
    await writeFile(join(dir, 'page.json'), JSON.stringify({ title: 'T' }));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes extracted text through with the extension as renderAs', async () => {
    await expect(
      makeProcessor().renderFile(join(dir, 'a.md')),
    ).resolves.toEqual({
      renderAs: 'md',
      content: 'hello world',
      rules: [],
      metadata: { matched_rules: [] },
      transformed: false,
    });
  });

  it('falls back to txt for a file without an extension', async () => {
    await expect(
      makeProcessor().renderFile(join(dir, 'README')),
    ).resolves.toMatchObject({
      renderAs: 'txt',
      content: 'plain text',
      transformed: false,
    });
  });

  it('returns the template output with the rule renderAs, writing nothing', async () => {
    await expect(
      makeProcessor().renderFile(join(dir, 'page.json')),
    ).resolves.toEqual({
      renderAs: 'html',
      content: '# page.json',
      rules: ['json-page'],
      metadata: { matched_rules: ['json-page'] },
      transformed: true,
    });
    expect(embed).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
