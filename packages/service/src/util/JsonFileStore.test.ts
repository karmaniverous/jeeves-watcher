import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonFileStoreOptions } from './JsonFileStore';
import { type TestData, TestJsonFileStore } from './TestJsonFileStore';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as JsonFileStoreOptions['logger'];
}

describe('JsonFileStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jw-jfs-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates parent directories on construction', () => {
    const nested = join(tmpDir, 'a', 'b', 'store.json');
    new TestJsonFileStore({ filePath: nested, logger: makeLogger() });
    expect(existsSync(join(tmpDir, 'a', 'b'))).toBe(true);
  });

  it('returns empty default when file does not exist', () => {
    const store = new TestJsonFileStore({
      filePath: join(tmpDir, 'store.json'),
      logger: makeLogger(),
    });
    const data = store.doLoad();
    expect(data).toEqual({ items: [] });
  });

  it('loads existing file from disk', () => {
    const filePath = join(tmpDir, 'store.json');
    const existing: TestData = { items: ['a', 'b'] };
    writeFileSync(filePath, JSON.stringify(existing));

    const store = new TestJsonFileStore({ filePath, logger: makeLogger() });
    expect(store.doLoad()).toEqual(existing);
  });

  it('caches after first load', () => {
    const store = new TestJsonFileStore({
      filePath: join(tmpDir, 'store.json'),
      logger: makeLogger(),
    });
    const first = store.doLoad();
    first.items.push('x');
    const second = store.doLoad();
    expect(second.items).toContain('x');
  });

  it('saves cache to disk', () => {
    const filePath = join(tmpDir, 'store.json');
    const store = new TestJsonFileStore({ filePath, logger: makeLogger() });
    store.setCache({ items: ['saved'] });
    store.doSave();

    const raw = readFileSync(filePath, 'utf-8');
    expect(JSON.parse(raw) as TestData).toEqual({ items: ['saved'] });
  });

  it('warns and returns empty on corrupt file', () => {
    const filePath = join(tmpDir, 'store.json');
    writeFileSync(filePath, '{{not json}}');

    const logger = makeLogger();
    const store = new TestJsonFileStore({ filePath, logger });
    const data = store.doLoad();

    expect(data).toEqual({ items: [] });
    expect(logger.warn).toHaveBeenCalled();
  });
});
