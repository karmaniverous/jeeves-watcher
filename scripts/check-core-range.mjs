/**
 * Release guard: fail when a package's declared range for the workspace core
 * package does not admit core's current version.
 *
 * The service, plugin and SDK import core at runtime, so publishing one with a
 * range that excludes the core it was built against installs a core without
 * the exports it needs (#277). Run from the package being released (the
 * release-it `before:init` hook does this):
 *
 *   node ../../scripts/check-core-range.mjs [--core <core package.json>] [--package <package.json>]
 *
 * `--core` defaults to `packages/core/package.json` in this repository and
 * `--package` to `package.json` in the working directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import semver from 'semver';

const scriptPath = fileURLToPath(import.meta.url);
const defaultCorePath = path.resolve(
  path.dirname(scriptPath),
  '../packages/core/package.json',
);

const DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies',
];

/** Read and parse a JSON file. */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Check a package manifest's declared range for core against core's version.
 * Returns `{ ok, message }`.
 */
export function checkCoreRange(core, pkg) {
  const field = DEPENDENCY_FIELDS.find((f) => pkg[f]?.[core.name]);
  if (!field) {
    return {
      ok: false,
      message: `${pkg.name} does not depend on ${core.name}.`,
    };
  }

  const range = pkg[field][core.name];
  if (semver.satisfies(core.version, range)) {
    return {
      ok: true,
      message: `${pkg.name}: ${core.name} range ${range} admits ${core.version}.`,
    };
  }

  return {
    ok: false,
    message: [
      `${pkg.name} declares ${core.name} ${range} (${field}), which does not admit the workspace core version ${core.version}.`,
      `Raise the range (e.g. ^${core.version}) in the release commit, and release ${core.name} first.`,
    ].join('\n'),
  };
}

/** Parse `--core` and `--package` options. */
function parseArgs(argv) {
  const options = {
    core: defaultCorePath,
    package: path.resolve('package.json'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/u, '');
    const value = argv[i + 1];
    if (!(name === 'core' || name === 'package') || value === undefined) {
      throw new Error(`Unknown or incomplete option: ${String(argv[i])}`);
    }
    options[name] = path.resolve(value);
  }
  return options;
}

/** CLI entry: exit 0 when the range admits core, 1 otherwise. */
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = checkCoreRange(
      readJson(options.core),
      readJson(options.package),
    );
    if (result.ok) {
      process.stdout.write(`${result.message}\n`);
      return 0;
    }
    process.stderr.write(`Release blocked: ${result.message}\n`);
    return 1;
  } catch (error) {
    process.stderr.write(
      `Release blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = main();
}
