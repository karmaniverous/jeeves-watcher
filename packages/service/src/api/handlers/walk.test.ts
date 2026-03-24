import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalkRouteDeps } from './walk';
import { createWalkHandler } from './walk';

describe('createWalkHandler', () => {
  const mockWatcher = {
    getWatchedFiles: vi.fn(),
    isReady: true,
  };

  beforeEach(() => {
    mockWatcher.getWatchedFiles.mockReset();
    mockWatcher.isReady = true;
  });

  const makeDeps = (): WalkRouteDeps => ({
    getWatchPaths: () => ['j:/domains/**/*.md', 'j:/config/**/*.json'],
    fileSystemWatcher: mockWatcher as never,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
  });

  it('filters watched files by caller globs', async () => {
    const deps = makeDeps();
    const handler = createWalkHandler(deps);

    mockWatcher.getWatchedFiles.mockReturnValue([
      'j:/domains/foo/.meta/meta.json',
      'j:/domains/bar/readme.md',
      'j:/domains/baz/.meta/meta.json',
    ]);

    const request = {
      body: { globs: ['**/.meta/meta.json'] },
    } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(sendMock).toHaveBeenCalledWith({
      paths: [
        'j:/domains/foo/.meta/meta.json',
        'j:/domains/baz/.meta/meta.json',
      ],
      matchedCount: 2,
      scannedRoots: expect.any(Array) as unknown as string[],
    });
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

  it('returns 503 when scan is in progress', async () => {
    const deps = makeDeps();
    mockWatcher.isReady = false;
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
      expect.objectContaining({ error: 'Scan in progress' }),
    );
  });

  it('returns 503 when watcher is not available', async () => {
    const deps: WalkRouteDeps = {
      getWatchPaths: () => ['j:/domains/**/*.md'],
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    };
    const handler = createWalkHandler(deps);

    const request = {
      body: { globs: ['**/*.md'] },
    } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(503);
  });
});
