/**
 * @module packaging.test
 * The service build keeps every runtime dependency external (D205): the SDK and watcher-core are declared dependencies, and the library and CLI builds import them rather than bundling a copy, so one `WatcherError` class serves the CLI and the SDK.
 */

import { readFileSync } from 'node:fs';

import type { RollupOptions } from 'rollup';
import { describe, expect, it } from 'vitest';

import config from '../rollup.config.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { dependencies: Record<string, string> };

const SDK = '@karmaniverous/jeeves-watcher-sdk';
const CORE = '@karmaniverous/jeeves-watcher-core';

/** Whether a build treats an import as external. */
const isExternal = (build: RollupOptions, id: string): boolean => {
  const { external } = build;
  if (!Array.isArray(external)) return false;
  return external.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(id) : pattern === id,
  );
};

/** The library and CLI builds (the declaration build has no runtime imports). */
const codeBuilds = config.filter((build) =>
  [build.output]
    .flat()
    .every((output) => output?.format === 'esm' && output.file === undefined),
);

describe('service packaging (D205)', () => {
  it('declares the SDK and watcher-core as runtime dependencies', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(
      expect.arrayContaining([SDK, CORE]),
    );
  });

  it('builds the library and at least one CLI', () => {
    expect(codeBuilds.map((build) => build.input)).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/cli/jeeves-watcher/index.ts',
      ]),
    );
  });

  it.each([SDK, `${SDK}/sub`, CORE, `${CORE}/sub`])(
    'keeps %s external in every code build',
    (id) => {
      for (const build of codeBuilds) expect(isExternal(build, id)).toBe(true);
    },
  );

  it('keeps every runtime dependency external in every code build', () => {
    for (const name of Object.keys(pkg.dependencies))
      for (const build of codeBuilds)
        expect(
          isExternal(build, name),
          `${name} in ${JSON.stringify(build.input)}`,
        ).toBe(true);
  });

  it('bundles the service own source', () => {
    for (const build of codeBuilds)
      expect(isExternal(build, './cli/cliClient.js')).toBe(false);
  });
});
