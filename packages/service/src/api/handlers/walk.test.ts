import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalkRouteDeps } from './walk';
import { createWalkHandler } from './walk';

// Mock the fileScan module
vi.mock('../fileScan', () => ({
  getWatchRootBases: vi.fn(),
  getWatchedFiles: vi.fn(),
}));

import { getWatchRootBases, getWatchedFiles } from '../fileScan';

const getWatchedFilesMock = vi.mocked(getWatchedFiles);
const getRootBasesMock = vi.mocked(getWatchRootBases);

describe('createWalkHandler', () => {
  beforeEach(() => {
    getWatchedFilesMock.mockReset();
    getRootBasesMock.mockReset();
  });

  const makeDeps = (): WalkRouteDeps => ({
    watchPaths: ['j:/domains/**/*.md', 'j:/config/**/*.json'],
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
  });

  it('returns 503 when initial scan is active', async () => {
    const deps: WalkRouteDeps = {
      ...makeDeps(),
      initialScanTracker: {
        getStatus: () => ({ active: true, filesMatched: 10, filesEnqueued: 5, startedAt: new Date().toISOString() }),
      } as never,
    };
    const handler = createWalkHandler(deps);

    const request = { body: { globs: ['**/*.md'] } } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(503);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Service Unavailable' }),
    );
  });

  it('uses in-memory watched files when fileSystemWatcher is available', async () => {
    const deps: WalkRouteDeps = {
      ...makeDeps(),
      fileSystemWatcher: {
        getWatched: () => ({
          'j:/domains': ['file1.md', 'file2.md'],
          'j:/config': ['settings.json'],
        }),
      } as never,
      initialScanTracker: {
        getStatus: () => ({ active: false }),
      } as never,
    };
    const handler = createWalkHandler(deps);

    getWatchedFilesMock.mockReturnValue([
      'j:/domains/file1.md',
      'j:/domains/file2.md',
      'j:/config/settings.json',
    ]);
    getRootBasesMock.mockReturnValue(['j:/domains', 'j:/config']);

    const request = { body: { globs: ['**/*.md'] } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(getWatchedFilesMock).toHaveBeenCalledWith({
      'j:/domains': ['file1.md', 'file2.md'],
      'j:/config': ['settings.json'],
    });
    expect(sendMock).toHaveBeenCalledWith({
      paths: expect.arrayContaining([expect.stringContaining('.md')]),
      matchedCount: expect.any(Number),
      scannedRoots: ['j:/domains', 'j:/config'],
    });
  });

  it('filters by glob patterns', async () => {
    const deps: WalkRouteDeps = {
      ...makeDeps(),
      fileSystemWatcher: {
        getWatched: () => ({
          'j:/domains': ['file1.md', 'file2.txt'],
          'j:/config': ['settings.json'],
        }),
      } as never,
      initialScanTracker: {
        getStatus: () => ({ active: false }),
      } as never,
    };
    const handler = createWalkHandler(deps);

    getWatchedFilesMock.mockReturnValue([
      'j:/domains/file1.md',
      'j:/domains/file2.txt',
      'j:/config/settings.json',
    ]);
    getRootBasesMock.mockReturnValue(['j:/domains', 'j:/config']);

    const request = { body: { globs: ['**/*.md'] } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    const response = sendMock.mock.calls[0]?.[0];
    expect(response.paths).toContain('j:/domains/file1.md');
    expect(response.paths).not.toContain('j:/domains/file2.txt');
    expect(response.paths).not.toContain('j:/config/settings.json');
  });

  it('applies gitignore filter when available', async () => {
    const isIgnoredMock = vi.fn().mockImplementation((path: string) => path.includes('ignored'));
    const deps: WalkRouteDeps = {
      ...makeDeps(),
      fileSystemWatcher: {
        getWatched: () => ({
          'j:/domains': ['file1.md', 'ignored.md'],
        }),
      } as never,
      gitignoreFilter: { isIgnored: isIgnoredMock } as never,
      initialScanTracker: {
        getStatus: () => ({ active: false }),
      } as never,
    };
    const handler = createWalkHandler(deps);

    getWatchedFilesMock.mockReturnValue(['j:/domains/file1.md', 'j:/domains/ignored.md']);
    getRootBasesMock.mockReturnValue(['j:/domains']);

    const request = { body: { globs: ['**/*.md'] } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(isIgnoredMock).toHaveBeenCalled();
    const response = sendMock.mock.calls[0]?.[0];
    expect(response.paths).toContain('j:/domains/file1.md');
    expect(response.paths).not.toContain('j:/domains/ignored.md');
  });

  it('rejects missing globs', async () => {
    const deps = makeDeps();
    const handler = createWalkHandler(deps);

    const request = { body: {} } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnThis().mockReturnValue({ send: sendMock });
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
    const statusMock = vi.fn().mockReturnThis().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
  });
});
