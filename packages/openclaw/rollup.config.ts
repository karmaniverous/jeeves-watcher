/**
 * @module rollup.config
 * Rollup configuration for the OpenClaw plugin package.
 *
 * @remarks
 * Two entry points: plugin (ESM + declarations) and CLI (ESM executable).
 * `@karmaniverous/jeeves` and its transitive dependencies are BUNDLED into
 * the output — OpenClaw loads plugins from `~/.openclaw/extensions/` where
 * there is no `node_modules` tree. Only Node built-ins are external.
 */

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';

/** Node built-ins that must remain external. */
const nodeBuiltins = [
  'node:child_process',
  'node:crypto',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:module',
  'node:os',
  'node:path',
  'node:process',
  'node:stream',
  'node:url',
  'node:util',
  // CJS aliases used by some deps
  'assert',
  'crypto',
  'events',
  'fs',
  'module',
  'os',
  'path',
  'stream',
  'url',
  'util',
];

const pluginConfig: RollupOptions = {
  input: 'src/index.ts',
  external: nodeBuiltins,
  output: {
    dir: 'dist',
    format: 'esm',
  },
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
  external: nodeBuiltins,
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
