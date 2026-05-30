/**
 * Rollup configuration for the OpenClaw plugin package.
 * Two entry points: plugin (ESM + declarations) and CLI (ESM executable).
 *
 * `@karmaniverous/jeeves` is externalized — the plugin installer copies
 * the jeeves core lib into the extensions directory alongside the plugin
 * output, so it is always resolvable at runtime.
 *
 * @module rollup.config
 */

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';

const external: (string | RegExp)[] = [/^node:/, '@karmaniverous/jeeves'];

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
    }),
  ],
};

const cliConfig: RollupOptions = {
  input: 'src/cli.ts',
  external,
  output: {
    file: 'dist/cli.js',
    format: 'esm',
    banner: '#!/usr/bin/env node',
  },
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescriptPlugin({
      tsconfig: './tsconfig.json',
      outputToFilesystem: false,
      noEmit: false,
      declaration: false,
      incremental: false,
    }),
  ],
};

export default [pluginConfig, cliConfig];
