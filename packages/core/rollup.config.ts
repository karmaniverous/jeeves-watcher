/**
 * Rollup configuration for the core library package.
 * Single entry point: ESM library output + bundled declarations.
 *
 * @module rollup.config
 */

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';
import dtsPlugin from 'rollup-plugin-dts';

const external = ['@karmaniverous/jeeves', '@karmaniverous/jsonmap', 'zod'];

const typescript = typescriptPlugin({
  tsconfig: './tsconfig.json',
  outputToFilesystem: false,
  include: ['src/**/*.ts'],
  exclude: ['**/*.test.ts'],
  noEmit: false,
  declaration: false,
  declarationMap: false,
  incremental: false,
});

/** ESM library output. */
const library: RollupOptions = {
  input: 'src/index.ts',
  external,
  output: [{ dir: 'dist', format: 'esm' }],
  plugins: [commonjs(), json(), nodeResolve(), typescript],
};

/** Bundled .d.ts declarations. */
const types: RollupOptions = {
  input: 'src/index.ts',
  output: [{ file: 'dist/index.d.ts', format: 'esm' }],
  plugins: [dtsPlugin()],
};

export default [library, types];
