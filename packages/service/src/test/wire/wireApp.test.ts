/**
 * @module test/wire/wireApp.test
 * The wire app's `reset`: it runs git only when the VCS repo differs from its last reset state, and whatever a scenario or a test changed in the repo (working tree, untracked paths, `.git/info/exclude`) is gone after it. Real git in a temp repo.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../git';
import { WIRE_SCENARIOS } from './scenarios';
import { startWireApp, VCS_FILES, type WireApp } from './wireApp';
import { injectScenario, runScenario } from './wireRun';

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
});

beforeEach(async () => {
  await wire.reset();
});

/** `git status` of the VCS root, untracked and ignored files included. */
const status = async () =>
  (
    await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--ignored'],
      { cwd: wire.vcsRoot },
    )
  ).stdout;

const excludeFile = () => join(wire.vcsRoot, '.git', 'info', 'exclude');

const scenario = (name: string) => {
  const found = WIRE_SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`no wire scenario ${name}`);
  return found;
};

describe('wire.reset', () => {
  it('leaves a clean repo and runs no git when nothing changed', async () => {
    const before = wire.gitResets;
    await wire.reset();
    await wire.reset();
    expect(wire.gitResets).toBe(before);
    expect(await status()).toBe('');
    await expect(readFile(excludeFile())).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['an untracked file', () => writeFile(join(wire.vcsRoot, 'new.md'), 'x')],
    [
      'an untracked file in a new directory',
      async () => {
        await mkdir(join(wire.vcsRoot, 'tmp'));
        await writeFile(join(wire.vcsRoot, 'tmp', 'a.log'), 'x');
      },
    ],
    ['an empty new directory', () => mkdir(join(wire.vcsRoot, 'empty'))],
    [
      'an edited tracked file',
      () => writeFile(join(wire.vcsRoot, 'notes.md'), '# Changed\n'),
    ],
    [
      'a same-length edit to a tracked file',
      () => writeFile(join(wire.vcsRoot, 'blob.xyz'), 'OPAQUE'),
    ],
    ['a deleted tracked file', () => rm(join(wire.vcsRoot, 'data.json'))],
    [
      'a written .git/info/exclude',
      () => writeFile(excludeFile(), '/notes.md\n'),
    ],
  ] as const)('restores the repo after %s', async (_, dirty) => {
    const before = wire.gitResets;
    await dirty();
    await wire.reset();
    expect(wire.gitResets).toBe(before + 1);
    expect(await status()).toBe('');
    await expect(readFile(excludeFile())).rejects.toMatchObject({
      code: 'ENOENT',
    });
    for (const [name, content] of Object.entries(VCS_FILES)) {
      expect(await readFile(join(wire.vcsRoot, name), 'utf8')).toBe(content);
    }
  });

  it('restores the repo after a VCS write route', async () => {
    const before = wire.gitResets;
    const res = await injectScenario(wire, scenario('vcsExclude add'));
    expect(res.statusCode).toBe(200);
    await wire.reset();
    expect(wire.gitResets).toBe(before + 1);
    expect(await status()).toBe('');
    await expect(readFile(excludeFile())).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('gives a VCS write scenario the same answer every time', async () => {
    const add = scenario('vcsExclude add');
    const first = await runScenario(wire, add);
    expect(await runScenario(wire, add)).toEqual(first);
  });
});
