/**
 * @module watcher/MoveCorrelator.test
 * Tests for MoveCorrelator move detection.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { ContentHashCache } from '../cache';
import { fileHash } from '../hash';
import { MoveCorrelator, type MoveCorrelatorOptions } from './MoveCorrelator';

let tmpDir: string;
let cache: ContentHashCache;
let onMove: Mock;
let onDelete: Mock;
let onCreate: Mock;

function createCorrelator(
  overrides: Partial<MoveCorrelatorOptions> = {},
): MoveCorrelator {
  return new MoveCorrelator({
    enabled: true,
    bufferMs: 200,
    contentHashCache: cache,
    logger: pino({ level: 'silent' }),
    onMove,
    onDelete,
    onCreate,
    ...overrides,
  });
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'jw-mc-'));
  cache = new ContentHashCache();
  onMove = vi.fn();
  onDelete = vi.fn();
  onCreate = vi.fn();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('MoveCorrelator', () => {
  it('passes through when disabled', () => {
    const correlator = createCorrelator({ enabled: false });
    correlator.handleUnlink('/old.txt');
    expect(onDelete).toHaveBeenCalledWith('/old.txt');
  });

  it('passes through add when disabled', async () => {
    const correlator = createCorrelator({ enabled: false });
    await correlator.handleAdd('/new.txt');
    expect(onCreate).toHaveBeenCalledWith('/new.txt');
  });

  it('detects a single move', async () => {
    const oldPath = join(tmpDir, 'old.txt');
    const newPath = join(tmpDir, 'new.txt');
    await writeFile(oldPath, 'hello world', 'utf8');

    // Populate cache for old path
    const hash = await fileHash(oldPath);
    cache.set(oldPath, hash);

    // "Move" the file
    const { rename } = await import('node:fs/promises');
    await rename(oldPath, newPath);

    const correlator = createCorrelator();
    correlator.handleUnlink(oldPath);
    await correlator.handleAdd(newPath);

    expect(onMove).toHaveBeenCalledWith(oldPath, newPath);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('falls back to delete after timeout', async () => {
    const oldPath = join(tmpDir, 'old.txt');
    await writeFile(oldPath, 'content', 'utf8');
    const hash = await fileHash(oldPath);
    cache.set(oldPath, hash);

    const correlator = createCorrelator({ bufferMs: 50 });
    correlator.handleUnlink(oldPath);

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 100));

    expect(onDelete).toHaveBeenCalledWith(oldPath);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('treats unlink as immediate delete when hash not in cache', () => {
    const correlator = createCorrelator();
    correlator.handleUnlink('/not-cached.txt');
    expect(onDelete).toHaveBeenCalledWith('/not-cached.txt');
  });

  it('treats add as create when no matching unlink', async () => {
    const newPath = join(tmpDir, 'brand-new.txt');
    await writeFile(newPath, 'new content', 'utf8');

    const correlator = createCorrelator();
    await correlator.handleAdd(newPath);

    expect(onCreate).toHaveBeenCalledWith(newPath);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('FIFO: matches oldest unlink on hash collision', async () => {
    const path1 = join(tmpDir, 'a.txt');
    const path2 = join(tmpDir, 'b.txt');
    const newPath = join(tmpDir, 'c.txt');

    // Same content → same hash
    await writeFile(path1, 'same content', 'utf8');
    await writeFile(path2, 'same content', 'utf8');
    const hash = await fileHash(path1);
    cache.set(path1, hash);
    cache.set(path2, hash);

    // Keep one copy for the add
    await writeFile(newPath, 'same content', 'utf8');

    const correlator = createCorrelator();
    correlator.handleUnlink(path1);
    correlator.handleUnlink(path2);

    await correlator.handleAdd(newPath);

    // Should match path1 (oldest FIFO)
    expect(onMove).toHaveBeenCalledWith(path1, newPath);
    expect(correlator.pendingCount).toBe(1);
  });

  it('flush emits all buffered unlinks as deletes', async () => {
    const path1 = join(tmpDir, 'x.txt');
    const path2 = join(tmpDir, 'y.txt');
    await writeFile(path1, 'content1', 'utf8');
    await writeFile(path2, 'content2', 'utf8');
    cache.set(path1, await fileHash(path1));
    cache.set(path2, await fileHash(path2));

    const correlator = createCorrelator();
    correlator.handleUnlink(path1);
    correlator.handleUnlink(path2);

    expect(correlator.pendingCount).toBe(2);
    correlator.flush();

    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(correlator.pendingCount).toBe(0);
  });

  it('handles add when file cannot be read', async () => {
    const correlator = createCorrelator();
    await correlator.handleAdd('/nonexistent/path.txt');
    expect(onCreate).toHaveBeenCalledWith('/nonexistent/path.txt');
  });
});
