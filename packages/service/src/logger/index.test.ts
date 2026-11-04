/**
 * @module logger/index.test
 * Logger creation and rotation (D171): pino-roll options (`1k` becomes `1024b`), rotation at 1,024 bytes, `maxFiles: 2` leaving 2 rotated files plus the active one across restarts and rotations (D184), a plain destination with rotation off, and refusals reaching the file and stderr. Real files in temp folders.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, flushLogger, logRefusal, rollOptions } from './index';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'logger-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

/** Close a file logger's destination and wait for it. */
async function close(logger: pino.Logger): Promise<void> {
  const stream = (logger as unknown as Record<symbol, unknown>)[
    pino.symbols.streamSym
  ] as (NodeJS.EventEmitter & { end: () => void }) | undefined;
  if (!stream) return;
  await new Promise<void>((resolve) => {
    stream.once('close', () => {
      resolve();
    });
    stream.end();
  });
}

/** Log `count` lines of about 100 bytes and flush. */
async function writeLines(logger: pino.Logger, count: number): Promise<void> {
  for (let i = 0; i < count; i++) logger.info({ i }, 'x'.repeat(60));
  logger.flush();
  // pino-roll checks the size after each write; let its stat calls run.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/** Log files in the folder (excluding anything else). */
async function logFiles(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith('.log')).sort();
}

describe('rollOptions', () => {
  it('passes sizes as <bytes>b and applies the defaults', () => {
    expect(rollOptions('/l/w.log', { maxSize: '1k' })).toMatchObject({
      file: '/l/w.log',
      size: '1024b',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      limit: { count: 14, removeOtherLogFiles: true },
      symlink: false,
      mkdir: true,
    });
    expect(rollOptions('/l/w.log').size).toBe(`${String(10 * 1024 * 1024)}b`);
    expect(
      rollOptions('/l/w.log', {
        maxSize: 2048,
        frequency: 'hourly',
        maxFiles: 2,
      }),
    ).toMatchObject({
      size: '2048b',
      frequency: 'hourly',
      limit: { count: 2 },
    });
  });
});

describe('createLogger', () => {
  it('logs to stdout without a file', async () => {
    const logger = await createLogger({ level: 'warn' });
    expect(logger.level).toBe('warn');
    expect((await createLogger()).level).toBe('info');
  });

  it('opens the file before returning, so the first line is kept', async () => {
    const file = join(dir, 'nested', 'watcher.log');
    const logger = await createLogger({ level: 'info', file, rotation: false });
    logger.info('first line');
    await close(logger);

    expect(await readFile(file, 'utf8')).toContain('first line');
  });

  it('rotates at 1,024 bytes', async () => {
    const file = join(dir, 'watcher.log');
    const logger = await createLogger({
      level: 'info',
      file,
      rotation: { maxSize: '1k', maxFiles: 5 },
    });
    await writeLines(logger, 15);
    await writeLines(logger, 15);
    await close(logger);

    expect((await logFiles()).length).toBeGreaterThan(1);
  });

  it('keeps maxFiles: 2 rotated files besides the active one across three restarts and three rotations', async () => {
    const file = join(dir, 'watcher.log');
    await writeFile(join(dir, 'unrelated.txt'), 'keep me');
    // Other *.log files in the folder are not pino-roll's to prune.
    for (const other of ['other.log', 'watcher-stderr.log']) {
      await writeFile(join(dir, other), 'keep me');
    }
    for (let restart = 0; restart < 3; restart++) {
      const logger = await createLogger({
        level: 'info',
        file,
        rotation: { maxSize: '1k', maxFiles: 2 },
      });
      for (let rotation = 0; rotation < 3; rotation++) {
        await writeLines(logger, 15);
      }
      await close(logger);
    }

    // D184: maxFiles rotated files plus the active one remain after a roll.
    const rolled = (await logFiles()).filter((name) =>
      /^watcher\.\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(name),
    );
    expect(rolled).toHaveLength(2 + 1);
    expect(await logFiles()).not.toContain('watcher.log');
    for (const other of ['unrelated.txt', 'other.log', 'watcher-stderr.log']) {
      expect(await readFile(join(dir, other), 'utf8')).toBe('keep me');
    }
  }, 30_000);
});

describe('flushLogger', () => {
  it('writes buffered lines before returning (process.exit follows)', async () => {
    const logger = await createLogger({
      level: 'info',
      file: join(dir, 'watcher.log'),
    });
    // While one write is in flight, later lines wait in SonicBoom's buffer.
    for (let i = 0; i < 2000; i++) logger.info('x'.repeat(512));
    logger.info('flushed-before-exit');

    flushLogger(logger);

    const [active] = readdirSync(dir).filter((n) => n.endsWith('.log'));
    expect(readFileSync(join(dir, active), 'utf8')).toContain(
      'flushed-before-exit',
    );
    await close(logger);
  });
});

describe('log file errors', () => {
  it('reports a destination error on stderr instead of crashing', async () => {
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = await createLogger({
      level: 'info',
      file: join(dir, 'watcher.log'),
    });
    const stream = (logger as unknown as Record<symbol, NodeJS.EventEmitter>)[
      pino.symbols.streamSym
    ];

    stream.emit('error', new Error('ENOSPC: no space left'));

    expect(stderr).toHaveBeenCalledWith(
      'Log file error: ENOSPC: no space left\n',
    );
    stderr.mockRestore();
    await close(logger);
  });
});

describe('logRefusal', () => {
  it('writes the refusal to the rotated log file and to stderr', async () => {
    const file = join(dir, 'watcher.log');
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = await createLogger({ level: 'info', file });

    logRefusal(logger, 'Refused: test', new Error('the reason'));

    const [active] = await logFiles();
    expect(await readFile(join(dir, active), 'utf8')).toContain(
      'Refused: test',
    );
    expect(stderr).toHaveBeenCalledWith('Refused: test: the reason\n');
    await close(logger);
  });

  it('still writes stderr when the logger has no file', async () => {
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = await createLogger({ level: 'silent' });

    logRefusal(logger, 'Refused: no file');

    expect(stderr).toHaveBeenCalledWith('Refused: no file\n');
  });
});
