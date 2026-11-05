/**
 * @module watcher/batch/classifyBatch.test
 * Batch classification from the disk (D127, D149, D179), table-tested with a fake `lstat` and inventory.
 */

import { describe, expect, it } from 'vitest';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { RawChangeEvent } from '../changeSource/types';
import {
  BATCH_LSTAT_CONCURRENCY,
  classifyBatch,
  type ClassifyContext,
  isShortName,
  type PathState,
} from './classifyBatch';

const ROOT = '/r';

/** A context over a fake disk and inventory. */
function context(
  disk: Record<string, PathState>,
  inventory: { files?: string[]; dirs?: string[] } = {},
  overrides: Partial<ClassifyContext> = {},
): ClassifyContext {
  const files = new Set((inventory.files ?? []).map(normalizeDocumentKey));
  const dirs = new Set((inventory.dirs ?? []).map(normalizeDocumentKey));
  return {
    root: ROOT,
    platform: 'linux',
    ignored: (path) => path.includes('/ignored'),
    isDirectory: (path) => dirs.has(normalizeDocumentKey(path)),
    inInventory: (path) => files.has(normalizeDocumentKey(path)),
    lstat: (path) => Promise.resolve(disk[path] ?? 'absent'),
    ...overrides,
  };
}

const create = (path: string): RawChangeEvent => ({ path, type: 'create' });
const update = (path: string): RawChangeEvent => ({ path, type: 'update' });
const del = (path: string): RawChangeEvent => ({ path, type: 'delete' });

describe('classifyBatch', () => {
  it('present files go to the stability wait, whatever the event type', async () => {
    const result = await classifyBatch(
      [create('/r/a.md'), update('/r/b.md'), del('/r/c.md')],
      context({ '/r/a.md': 'file', '/r/b.md': 'file', '/r/c.md': 'file' }),
    );
    expect(result).toEqual({
      rootGone: false,
      paths: [
        { kind: 'file', path: '/r/a.md' },
        { kind: 'file', path: '/r/b.md' },
        { kind: 'file', path: '/r/c.md' },
      ],
    });
  });

  it('a directory create is a create event or a re-created directory (D179)', async () => {
    const disk: Record<string, PathState> = {
      '/r/new': 'dir',
      '/r/touched': 'dir',
      '/r/again': 'dir',
    };
    const result = await classifyBatch(
      [
        create('/r/new'),
        update('/r/touched'),
        del('/r/again'),
        create('/r/again'),
        del('/r/again/old.md'),
      ],
      context(disk, { files: ['/r/again/old.md'], dirs: ['/r/again'] }),
    );
    expect(result).toEqual({
      rootGone: false,
      paths: [
        { kind: 'dirCreate', path: '/r/new' },
        { kind: 'dirCreate', path: '/r/again' },
        { kind: 'unlink', path: '/r/again/old.md' },
      ],
    });
  });

  it('a directory recreated without its own create event is still a create', async () => {
    const result = await classifyBatch(
      [update('/r/d'), del('/r/d/x.md')],
      context({ '/r/d': 'dir' }, { files: ['/r/d/x.md'], dirs: ['/r/d'] }),
    );
    expect(result).toMatchObject({
      paths: [
        { kind: 'dirCreate', path: '/r/d' },
        { kind: 'unlink', path: '/r/d/x.md' },
      ],
    });
  });

  it('absent paths: directory delete, file unlink, or dropped (D127)', async () => {
    const result = await classifyBatch(
      [del('/r/dir'), del('/r/file.md'), del('/r/unknown.md')],
      context({}, { files: ['/r/file.md', '/r/dir/x.md'], dirs: ['/r/dir'] }),
    );
    expect(result).toEqual({
      rootGone: false,
      paths: [
        { kind: 'dirDelete', path: '/r/dir' },
        { kind: 'unlink', path: '/r/file.md' },
      ],
    });
  });

  it('paths under a deleted directory are covered by it', async () => {
    const result = await classifyBatch(
      [del('/r/dir/a.md'), del('/r/dir/sub'), del('/r/dir'), del('/r/dirx.md')],
      context(
        {},
        {
          files: ['/r/dir/a.md', '/r/dir/sub/b.md', '/r/dirx.md'],
          dirs: ['/r/dir', '/r/dir/sub'],
        },
      ),
    );
    expect(result).toMatchObject({
      paths: [
        { kind: 'dirDelete', path: '/r/dir' },
        { kind: 'unlink', path: '/r/dirx.md' },
      ],
    });
  });

  it('unknown 8.3 short names reconcile their parent on Windows only', async () => {
    const batch = [
      del('/r/PROGRA~1'),
      del('/r/LONGFI~2.MD'),
      del('/r/plain.md'),
    ];
    await expect(
      classifyBatch(batch, context({}, {}, { platform: 'win32' })),
    ).resolves.toEqual({
      rootGone: false,
      paths: [
        { kind: 'shortName', path: '/r/PROGRA~1' },
        { kind: 'shortName', path: '/r/LONGFI~2.MD' },
      ],
    });
    await expect(classifyBatch(batch, context({}))).resolves.toEqual({
      rootGone: false,
      paths: [],
    });
  });

  it('drops ignored paths before any lstat, and paths lstat cannot classify', async () => {
    const asked: string[] = [];
    const result = await classifyBatch(
      [create('/r/ignored/x.md'), create('/r/link'), update('/r/x.md')],
      context(
        { '/r/link': 'other', '/r/x.md': 'file' },
        {},
        {
          lstat: (path) => {
            asked.push(path);
            return Promise.resolve(path === '/r/x.md' ? 'file' : 'other');
          },
        },
      ),
    );
    expect(asked).toEqual(['/r/link', '/r/x.md']);
    expect(result).toMatchObject({
      paths: [{ kind: 'file', path: '/r/x.md' }],
    });
  });

  it('merges repeated events for one path', async () => {
    const result = await classifyBatch(
      [update('/r/d'), create('/r/d'), update('/r/d')],
      context({ '/r/d': 'dir' }),
    );
    expect(result).toMatchObject({
      paths: [{ kind: 'dirCreate', path: '/r/d' }],
    });
  });

  it('a batch naming the absent root is dropped whole; a present root is skipped', async () => {
    await expect(
      classifyBatch(
        [del('/r'), del('/r/a.md')],
        context({}, { files: ['/r/a.md'] }),
      ),
    ).resolves.toEqual({ rootGone: true });
    await expect(
      classifyBatch(
        [update('/r'), create('/r/a.md')],
        context({ '/r': 'dir', '/r/a.md': 'file' }),
      ),
    ).resolves.toEqual({
      rootGone: false,
      paths: [{ kind: 'file', path: '/r/a.md' }],
    });
  });

  it(`lstats at most ${String(BATCH_LSTAT_CONCURRENCY)} paths at a time`, async () => {
    let active = 0;
    let peak = 0;
    const events = Array.from({ length: 500 }, (_, i) =>
      update(`/r/f${String(i)}`),
    );
    await classifyBatch(
      events,
      context(
        {},
        {},
        {
          lstat: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return 'file';
          },
        },
      ),
    );
    expect(peak).toBe(BATCH_LSTAT_CONCURRENCY);
  });
});

describe('isShortName', () => {
  it.each([
    ['PROGRA~1', true],
    ['DOCUME~12', true],
    ['LONGFI~1.TXT', true],
    ['abc~1.md', true],
    ['~$lock.docx', false],
    ['file~.md', false],
    ['toolongname~1', false],
    ['a~1.long', false],
    ['plain.md', false],
  ])('%s -> %s', (name, expected) => {
    expect(isShortName(name)).toBe(expected);
  });
});
