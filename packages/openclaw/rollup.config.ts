/**
 * Rollup configuration for the OpenClaw plugin package.
 * Single entry point: the plugin (ESM + declarations).
 *
 * Every runtime dependency (`@karmaniverous/jeeves`,
 * `@karmaniverous/jeeves-watcher-core`, `@karmaniverous/jeeves-watcher-sdk`)
 * and its sub-paths is external: `openclaw plugins install` installs them
 * alongside the plugin, so `dist` holds the plugin's own code only (D205).
 *
 * @module rollup.config
 */

import { readFileSync } from 'node:fs';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { dependencies?: Record<string, string> };

/** Escape a package name for use in a regular expression. */
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Node built-ins, and each runtime dependency with its sub-paths. */
export const external: RegExp[] = [
  /^node:/,
  ...Object.keys(pkg.dependencies ?? {}).map(
    (name) => new RegExp(`^${escapeRegExp(name)}(?:/|$)`),
  ),
];

const pluginConfig: RollupOptions = {
  input: 'src/index.ts',
  output: { dir: 'dist', format: 'esm' },
  external,
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescriptPlugin({
      tsconfig: './tsconfig.json',
      outputToFilesystem: false,
      noEmit: false,
      declaration: true,
      declarationDir: 'dist',
      declarationMap: false,
      incremental: false,
      // Type against the built core package, not the source path mapping
      // used by typecheck/tests (see tsconfig.json).
      paths: {},
    }),
  ],
};

export default [pluginConfig];
