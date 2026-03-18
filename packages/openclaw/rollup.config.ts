/**
 * @module rollup.config
 * Rollup configuration for the OpenClaw plugin package.
 * Two entry points: plugin (ESM + declarations) and CLI (ESM executable).
 */

import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';

const pluginConfig: RollupOptions = {
  input: 'src/index.ts',
  external: [
    '@karmaniverous/jeeves',
    'node:child_process',
    'node:module',
    'node:util',
  ],
  output: {
    dir: 'dist',
    format: 'esm',
  },
  plugins: [
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
  external: [
    '@karmaniverous/jeeves',
    'fs',
    'path',
    'os',
    'url',
    'node:fs',
    'node:path',
    'node:os',
    'node:url',
  ],
  output: {
    file: 'dist/cli.js',
    format: 'esm',
    banner: '#!/usr/bin/env node',
  },
  plugins: [
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
