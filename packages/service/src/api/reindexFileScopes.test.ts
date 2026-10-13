/**
 * @module api/reindexFileScopes.test
 * listScopeFiles per scope (issue file keys only, path targets, rules globs, every watched file), filePlan, and runFileScope dispatch: issues counts per-file errors, path reports progress, rules/full go through processAllFiles with the listed files.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';
import { processAllFiles } from './processAllFiles';
import { filePlan, listScopeFiles, runFileScope } from './reindexFileScopes';
import { collectPathFiles } from './reindexPathFiles';
import type { ExecuteReindexDeps } from './reindexTypes';

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn(),
  listFilesFromWatchRoots: vi.fn(),
}));
vi.mock('./reindexPathFiles', () => ({ collectPathFiles: vi.fn() }));
vi.mock('./processAllFiles', () => ({ processAllFiles: vi.fn() }));

const processFile = vi.fn<(path: string) => Promise<void>>();

const deps = {
  config: {
    watch: { paths: ['/w/docs/**'], ignored: ['**/tmp/**'] },
    reindex: { concurrency: 2 },
  },
  processor: { processFile },
  logger: pino({ level: 'silent' }),
  issuesManager: {
    getAll: () => ({
      '/w/docs/a.md': [],
      'app://chat/1': [],
    }),
  },
} as unknown as ExecuteReindexDeps;

beforeEach(() => {
  vi.mocked(listFilesFromGlobs)
    .mockReset()
    .mockResolvedValue(['/w/docs/all.md']);
  vi.mocked(listFilesFromWatchRoots)
    .mockReset()
    .mockResolvedValue(['/w/docs/r.md']);
  vi.mocked(collectPathFiles).mockReset().mockResolvedValue(['/w/docs/p.md']);
  vi.mocked(processAllFiles).mockReset().mockResolvedValue(7);
  processFile.mockReset().mockResolvedValue(undefined);
});

describe('listScopeFiles', () => {
  it('issues: file keys of the issues store, never source references', async () => {
    expect(await listScopeFiles(deps, 'issues', undefined)).toEqual([
      '/w/docs/a.md',
    ]);
  });

  it('path: the resolved targets', async () => {
    expect(await listScopeFiles(deps, 'path', ['/w/docs/p.md'])).toEqual([
      '/w/docs/p.md',
    ]);
    expect(collectPathFiles).toHaveBeenCalledWith(
      ['/w/docs/p.md'],
      deps.config,
      undefined,
    );
  });

  it('rules with globs: watch roots intersected with the globs', async () => {
    expect(await listScopeFiles(deps, 'rules', ['**/r.md'])).toEqual([
      '/w/docs/r.md',
    ]);
    expect(
      vi.mocked(listFilesFromWatchRoots).mock.calls[0].slice(0, 3),
    ).toEqual([['/w/docs/**'], ['**/tmp/**'], ['**/r.md']]);
  });

  it.each([
    ['full', undefined],
    ['rules', undefined],
  ] as const)('%s: every watched file', async (scope, path) => {
    expect(await listScopeFiles(deps, scope, path)).toEqual(['/w/docs/all.md']);
  });
});

describe('filePlan', () => {
  it('counts files per watch root, nothing to delete', () => {
    expect(filePlan(['/w/docs/a.md', '/x/b.md'], deps.config)).toEqual({
      total: 2,
      toProcess: 2,
      toDelete: 0,
      byRoot: { '/w/docs': 1, '(unmatched)': 1 },
    });
  });
});

describe('runFileScope', () => {
  const progress = () => ({ onTotal: vi.fn(), onProcessed: vi.fn() });

  it('issues: processes each file and counts failures', async () => {
    processFile.mockRejectedValueOnce(new Error('boom'));
    const result = await runFileScope(
      deps,
      'issues',
      ['/a.md', '/b.md'],
      progress(),
    );
    expect(result).toEqual({ filesProcessed: 1, errors: 1 });
    expect(processFile).toHaveBeenCalledTimes(2);
  });

  it('path: processes the files and reports progress', async () => {
    const hooks = progress();
    const result = await runFileScope(deps, 'path', ['/a.md', '/b.md'], hooks);
    expect(result).toEqual({ filesProcessed: 2, errors: 0 });
    expect(hooks.onTotal).toHaveBeenCalledWith(2);
    expect(hooks.onProcessed).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['rules', 'processRulesUpdate'],
    ['full', 'processFile'],
  ] as const)(
    '%s: processAllFiles with %s over the listed files',
    async (scope, method) => {
      const result = await runFileScope(deps, scope, ['/a.md'], progress());
      expect(result).toEqual({ filesProcessed: 7, errors: 0 });
      const call = vi.mocked(processAllFiles).mock.calls[0];
      expect(call[3]).toBe(method);
      expect(call[4]).toBe(2);
      expect(call[7]).toEqual(['/a.md']);
    },
  );
});
