import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalkRouteDeps } from './walk';
import { createWalkHandler } from './walk';

// Mock the fileScan module
vi.mock('../fileScan', () => ({
  listFilesFromWatchRoots: vi.fn(),
  getWatchRootBases: vi.fn(),
}));

import { getWatchRootBases, listFilesFromWatchRoots } from '../fileScan';

const listFilesMock = vi.mocked(listFilesFromWatchRoots);
const getRootBasesMock = vi.mocked(getWatchRootBases);

describe('createWalkHandler', () => {
  beforeEach(() => {
    listFilesMock.mockReset();
    getRootBasesMock.mockReset();
  });

  const makeDeps = (): WalkRouteDeps => ({
    watchPaths: ['j:/domains/**/*.md', 'j:/config/**/*.json'],
    watchIgnored: ['**/node_modules/**'],
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
  });

  it('passes globs through to listFilesFromWatchRoots', async () => {
    const deps = makeDeps();
    const handler = createWalkHandler(deps);

    const matchedPaths = ['j:/domains/foo/.meta/meta.json'];
    listFilesMock.mockResolvedValue(matchedPaths);
    getRootBasesMock.mockReturnValue(['j:/domains', 'j:/config']);

    const request = {
      body: { globs: ['**/.meta/meta.json'] },
    } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(listFilesMock).toHaveBeenCalledWith(
      deps.watchPaths,
      deps.watchIgnored,
      ['**/.meta/meta.json'],
      undefined,
    );
    expect(sendMock).toHaveBeenCalledWith({
      paths: matchedPaths,
      matchedCount: 1,
      scannedRoots: ['j:/domains', 'j:/config'],
    });
  });

  it('passes gitignoreFilter when available', async () => {
    const isIgnoredMock = vi.fn().mockReturnValue(false);
    const deps: WalkRouteDeps = {
      watchPaths: ['j:/domains/**/*.md'],
      watchIgnored: [],
      gitignoreFilter: { isIgnored: isIgnoredMock } as never,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    };
    const handler = createWalkHandler(deps);

    listFilesMock.mockResolvedValue([]);
    getRootBasesMock.mockReturnValue([]);

    const request = {
      body: { globs: ['**/*.md'] },
    } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    // The fourth argument should be a function (the isGitignored callback)
    const isGitignored = listFilesMock.mock.calls[0]?.[3];
    expect(typeof isGitignored).toBe('function');
  });

  it('rejects missing globs', async () => {
    const deps = makeDeps();
    const handler = createWalkHandler(deps);

    const request = { body: {} } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Missing globs' }),
    );
  });

  it('rejects empty globs array', async () => {
    const deps = makeDeps();
    const handler = createWalkHandler(deps);

    const request = { body: { globs: [] } } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
  });
});
