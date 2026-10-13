/**
 * @module processor/resolvers/FileResolver.test
 * FileResolver wraps the existing file path: file identity, extension-selected splitter, dates from the metadata build (no second stat), move-cache hash, skip-when-unchanged, values index fed on resolve.
 */

import pino from 'pino';
import { describe, expect, it, type Mock, vi } from 'vitest';

import type { ContentHashCache } from '../../cache';
import { FileResolver } from './FileResolver';

vi.mock('../buildMetadata', () => ({ buildMergedMetadata: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({ birthtimeMs: 1500, mtimeMs: 2500 }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('raw')),
}));

import { stat } from 'node:fs/promises';

import { buildMergedMetadata } from '../buildMetadata';

describe('FileResolver', () => {
  it('resolves a file into a pipeline document', async () => {
    (buildMergedMetadata as Mock).mockResolvedValue({
      metadata: { domain: 'docs' },
      extracted: { text: 'body' },
      renderedContent: null,
      matchedRules: ['r'],
      renderAs: null,
      dates: { createdAt: 1, modifiedAt: 2 },
    });
    const set = vi.fn();
    const valuesManager = { update: vi.fn() };
    const resolver = new FileResolver({
      compiledRules: [],
      config: {},
      logger: pino({ level: 'silent' }),
      contentHashCache: { set } as unknown as ContentHashCache,
      valuesManager,
    });

    const outcome = await resolver.resolve('/docs/A.md');
    if (outcome.kind !== 'document') throw new Error('expected document');
    const doc = outcome.document;

    expect(doc.identity).toEqual({ kind: 'file', filePath: '/docs/A.md' });
    expect(doc.text).toBe('body');
    expect(doc.splitterExt).toBe('.md');
    expect(doc.metadataWithRules).toEqual({
      domain: 'docs',
      matched_rules: ['r'],
    });
    expect(doc.onUnchanged).toBe('skip');
    // No rule renderAs: the extension; extracted text is not transformed.
    expect(doc.renderAs).toBe('md');
    expect(doc.transformed).toBe(false);
    expect(doc.logLabel).toBe('File');
    expect(valuesManager.update).not.toHaveBeenCalled();
    doc.onResolved?.();
    expect(valuesManager.update).toHaveBeenCalledWith('r', { domain: 'docs' });
    await expect(doc.dates(null)).resolves.toEqual({
      createdAt: 1,
      modifiedAt: 2,
    });
    expect(stat).not.toHaveBeenCalled();
    await doc.prepare?.();
    expect(set).toHaveBeenCalledWith('/docs/A.md', expect.any(String));
  });

  it('prefers rendered content', async () => {
    (buildMergedMetadata as Mock).mockResolvedValue({
      metadata: {},
      extracted: { text: 'raw' },
      renderedContent: '# rendered',
      matchedRules: [],
      renderAs: 'md',
    });
    const resolver = new FileResolver({
      compiledRules: [],
      config: {},
      logger: pino({ level: 'silent' }),
    });
    const outcome = await resolver.resolve('/docs/a.json');
    if (outcome.kind !== 'document') throw new Error('expected document');
    expect(outcome.document.text).toBe('# rendered');
    expect(outcome.document.splitterExt).toBe('.json');
    expect(outcome.document.renderAs).toBe('md');
    expect(outcome.document.transformed).toBe(true);
  });
});
