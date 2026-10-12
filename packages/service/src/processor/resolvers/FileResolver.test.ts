/**
 * @module processor/resolvers/FileResolver.test
 * FileResolver wraps the existing file path: file identity, extension-selected splitter, stat dates, move-cache hash.
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

import { buildMergedMetadata } from '../buildMetadata';

describe('FileResolver', () => {
  it('resolves a file into a pipeline document', async () => {
    (buildMergedMetadata as Mock).mockResolvedValue({
      metadata: { domain: 'docs' },
      extracted: { text: 'body' },
      renderedContent: null,
      matchedRules: ['r'],
      renderAs: null,
    });
    const set = vi.fn();
    const resolver = new FileResolver({
      compiledRules: [],
      config: {},
      logger: pino({ level: 'silent' }),
      contentHashCache: { set } as unknown as ContentHashCache,
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
    expect(doc.refreshMetadataWhenUnchanged).toBe(false);
    await expect(doc.dates(null)).resolves.toEqual({
      createdAt: 1,
      modifiedAt: 2,
    });
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
  });
});
