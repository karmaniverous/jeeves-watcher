import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalkRouteDeps } from './walk';
import { createWalkHandler } from './walk';

// Mock the fileScan module
vi.mock('../fileScan', () => ({
  getWatchRootBases: vi.fn(),
}));

import { getWatchRootBases } from '../fileScan';

const getRootBasesMock = vi.mocked(getWatchRootBases);

describe('createWalkHandler', () => {
  beforeEach(() => {
    getRootBasesMock.mockReset();
  });

  const makeDeps = (overrides?: Partial<WalkRouteDeps>): WalkRouteDeps => ({
    watchPaths: ['j:/domains/**/*.md', 'j:/config/**/*.json'],
    watchIgnored: ['**/node_modules/**'],
    fileSystemWatcher: undefined,
    initialScanTracker: undefined,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    ...overrides,
  });

  it('returns watched files from FileSystemWatcher', async () => {
    const mockFiles = ['j:/domains/foo/.meta/meta.json'];
    const mockWatcher = {
      getWatchedFiles: vi.fn().mockReturnValue(mockFiles),
    } as never;

    const deps = makeDeps({
      fileSystemWatcher: mockWatcher,
      initialScanTracker: { getStatus: () => ({ active: false }) } as never,
    });
    const handler = createWalkHandler(deps);

    getRootBasesMock.mockReturnValue(['j:/domains', 'j:/config']);

    const request = {
      body: { globs: ['**/.meta/meta.json'] },
    } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(mockWatcher.getWatchedFiles).toHaveBeenCalledWith([
      '**/.meta/meta.json',
    ]);
    expect(sendMock).toHaveBeenCalledWith({
      paths: mockFiles,
      matchedCount: 1,
      scannedRoots: ['j:/domains', 'j:/config'],
    });
  });

  it('returns 503 when initial scan is active', async () => {
    const deps = makeDeps({
      fileSystemWatcher: { getWatchedFiles: vi.fn() } as never,
      initialScanTracker: { getStatus: () => ({ active: true }) } as never,
    });
    const handler = createWalkHandler(deps);

    const request = {
      body: { globs: ['**/*.md'] },
    } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(503);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Initial scan in progress' }),
    );
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

  it('returns empty array when FileSystemWatcher not available', async () => {
    const deps = makeDeps({
      initialScanTracker: { getStatus: () => ({ active: false }) } as never,
    });
    const handler = createWalkHandler(deps);

    getRootBasesMock.mockReturnValue(['j:/domains', 'j:/config']);

    const request = {
      body: { globs: ['**/*.md'] },
    } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(sendMock).toHaveBeenCalledWith({
      paths: [],
      matchedCount: 0,
      scannedRoots: ['j:/domains', 'j:/config'],
    });
  });
});
