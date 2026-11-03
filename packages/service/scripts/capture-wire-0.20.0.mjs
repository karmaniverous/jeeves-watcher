#!/usr/bin/env node
/**
 * Capture the 0.20.0 wire baseline (spec Design 2, D143).
 *
 * Checks tag `service/0.20.0` out into a temporary git worktree, installs it,
 * copies the current wire harness (`src/test/wire/*`) and the recording config
 * into it, records every wire scenario against the 0.20.0 server, and writes
 * the records to `src/test/wire/wire-0.20.0.json`. The worktree is removed
 * afterwards, whether or not the capture succeeds.
 *
 * Usage (from packages/service): node scripts/capture-wire-0.20.0.mjs [--tag <tag>] [--out <path>]
 *
 * The harness must stay portable to the tag: it may only import service
 * modules that already exist there.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const repo = resolve(pkg, '..', '..');

const { values } = parseArgs({
  options: {
    tag: { type: 'string', default: 'service/0.20.0' },
    out: {
      type: 'string',
      default: join(pkg, 'src', 'test', 'wire', 'wire-0.20.0.json'),
    },
  },
});
const out = resolve(values.out);

/**
 * Run a command, inheriting stdio; `shell` lets npm/npx resolve on Windows.
 *
 * @param {string} cmd - Executable.
 * @param {string[]} args - Arguments.
 * @param {string} cwd - Working directory.
 * @param {Record<string, string>} [env] - Extra environment variables.
 */
const run = (cmd, args, cwd, env = {}) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });

const worktree = mkdtempSync(join(tmpdir(), 'jeeves-watcher-wire-capture-'));
process.stdout.write(
  `capture: ${values.tag} -> ${out}\nworktree: ${worktree}\n`,
);
run('git', ['worktree', 'add', '--detach', worktree, values.tag], repo);
try {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], worktree);

  const wireSrc = join(pkg, 'src', 'test', 'wire');
  const wireDst = join(worktree, 'packages', 'service', 'src', 'test', 'wire');
  mkdirSync(wireDst, { recursive: true });
  for (const name of readdirSync(wireSrc)) {
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      copyFileSync(join(wireSrc, name), join(wireDst, name));
    }
  }
  copyFileSync(
    join(pkg, 'vitest.wire-record.config.mts'),
    join(worktree, 'packages', 'service', 'vitest.wire-record.config.mts'),
  );

  run(
    'npx',
    ['vitest', 'run', '--config', 'vitest.wire-record.config.mts'],
    join(worktree, 'packages', 'service'),
    { WIRE_RECORD: out, QDRANT_URL: '' },
  );
  const records = JSON.parse(readFileSync(out, 'utf8'));
  process.stdout.write(
    `capture: wrote ${Object.keys(records).length} records\n`,
  );
} finally {
  run('git', ['worktree', 'remove', '--force', worktree], repo);
}
