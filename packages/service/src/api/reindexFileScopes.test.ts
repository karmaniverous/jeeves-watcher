/**
 * @module api/reindexFileScopes.test
 * listScopeFiles per scope (issue file keys only, path targets, rules globs, every watched file), filePlan, and runFileScope: one error policy for every scope (failures collected, the run continues, progress after every file), rules re-applies rules and every other scope re-processes files.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';
import { filePlan, listScopeFiles, runFileScope } from './reindexFileScopes';
import { collectPathFiles } from './reindexPathFiles';
import type { ExecuteReindexDeps } from './reindexTypes';

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn(),
  listFilesFromWatchRoots: vi.fn(),
}));
vi.mock('./reindexPathFiles', () => ({ collectPathFiles: vi.fn() }));

const processFile = vi.fn<(path: string) => Promise<void>>();
const processRulesUpdate = vi.fn<(path: string) => Promise<null>>();

const deps = {
  config: {
    watch: { paths: ['/w/docs/**'], ignored: ['**/tmp/**'] },
    reindex: { concurrency: 2 },
  },
  processor: { processFile, processRulesUpdate },
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
  processRulesUpdate.mockReset().mockResolvedValue(null);
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
  it.each(['issues', 'path', 'full'] as const)(
    '%s: re-processes each file, collects failures and keeps going',
    async (scope) => {
      processFile.mockImplementation((path) =>
        path === '/a.md'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(),
      );
      const onProcessed = vi.fn();
      const result = await runFileScope(
        deps,
        scope,
        ['/a.md', '/b.md', '/c.md'],
        onProcessed,
      );
      expect(result).toEqual({ filesProcessed: 2, failed: ['/a.md'] });
      expect(processFile).toHaveBeenCalledTimes(3);
      expect(processRulesUpdate).not.toHaveBeenCalled();
      expect(onProcessed).toHaveBeenCalledTimes(3);
    },
  );

  it('rules: re-applies rules to each file with the same policy', async () => {
    processRulesUpdate.mockImplementation((path) =>
      path === '/a.md'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(null),
    );
    const result = await runFileScope(
      deps,
      'rules',
      ['/a.md', '/b.md'],
      vi.fn(),
    );
    expect(result).toEqual({ filesProcessed: 1, failed: ['/a.md'] });
    expect(processRulesUpdate.mock.calls.map(([f]) => f).sort()).toEqual([
      '/a.md',
      '/b.md',
    ]);
    expect(processFile).not.toHaveBeenCalled();
  });
});
