/**
 * Tests for the release guard (`check-core-range.mjs`), run with `node --test`.
 * Fixture manifests only: the live packages' ranges are irrelevant here.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { checkCoreRange } from './check-core-range.mjs';

const script = fileURLToPath(
  new URL('./check-core-range.mjs', import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-range-'));
const CORE = '@karmaniverous/jeeves-watcher-core';

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a fixture manifest and return its path. */
function manifest(name, json) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, JSON.stringify(json));
  return file;
}

/**
 * Run the CLI against fixture manifests: from the dependent package's
 * directory, or (with `cwdManifest` false) from a directory without a
 * manifest, passing the dependent's manifest as `--package`.
 */
function run(coreVersion, deps, cwdManifest = true) {
  const id = `${coreVersion}-${String(Math.random()).slice(2)}`;
  const core = manifest(`core-${id}`, { name: CORE, version: coreVersion });
  const pkg = manifest(`pkg-${id}`, {
    name: 'dependent',
    version: '1.0.0',
    ...deps,
  });
  const args = cwdManifest
    ? [script, '--core', core]
    : [script, '--core', core, '--package', pkg];
  return spawnSync(process.execPath, args, {
    cwd: cwdManifest ? path.dirname(pkg) : tmp,
    encoding: 'utf8',
  });
}

describe('check-core-range CLI', () => {
  it('exits 0 when the declared range admits the core version', () => {
    const res = run('0.4.0', { dependencies: { [CORE]: '^0.4.0' } });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /admits 0\.4\.0/u);
  });

  it('exits 1 when the declared range excludes the core version', () => {
    const res = run('0.4.0', { dependencies: { [CORE]: '^0.3.0' } });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\^0\.3\.0.*does not admit.*0\.4\.0/u);
    assert.match(
      res.stderr,
      /release @karmaniverous\/jeeves-watcher-core first/u,
    );
  });

  it('reads --package instead of the working directory', () => {
    const admitted = run(
      '0.4.0',
      { dependencies: { [CORE]: '^0.4.0' } },
      false,
    );
    assert.equal(admitted.status, 0, admitted.stderr);
    const res = run('0.4.0', { dependencies: { [CORE]: '^0.3.0' } }, false);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\^0\.3\.0.*does not admit.*0\.4\.0/u);
  });

  it('exits 1 when the package does not depend on core', () => {
    const res = run('0.4.0', { dependencies: { zod: '^4.0.0' } });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /does not depend on/u);
  });

  it('exits 1 on an unknown option', () => {
    const res = spawnSync(process.execPath, [script, '--nope', 'x'], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unknown or incomplete option/u);
  });
});

describe('release-it wiring', () => {
  for (const dir of ['service', 'openclaw', 'sdk']) {
    it(`runs the guard first in ${dir}'s before:init hook`, () => {
      const pkg = JSON.parse(
        fs.readFileSync(
          new URL(`../packages/${dir}/package.json`, import.meta.url),
          'utf8',
        ),
      );
      assert.equal(
        pkg['release-it'].hooks['before:init'][0],
        'node ../../scripts/check-core-range.mjs',
      );
    });
  }
});

describe('checkCoreRange', () => {
  const core = { name: CORE, version: '0.4.0' };

  it('accepts a satisfied peer range', () => {
    const result = checkCoreRange(core, {
      name: 'p',
      peerDependencies: { [CORE]: '>=0.4.0' },
    });
    assert.equal(result.ok, true);
  });

  it('rejects a pre-release core outside a caret range', () => {
    const result = checkCoreRange(
      { name: CORE, version: '0.5.0-0' },
      { name: 'p', dependencies: { [CORE]: '^0.4.0' } },
    );
    assert.equal(result.ok, false);
  });
});
