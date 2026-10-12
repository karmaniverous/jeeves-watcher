/**
 * Rollup configuration for the SDK package.
 * Single entry point: ESM library output + bundled declarations.
 *
 * `@karmaniverous/jeeves-watcher-core` is external in both outputs: it is the
 * SDK's only runtime dependency, and its types are imported, not inlined.
 *
 * @module rollup.config
 */

import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';
import dtsPlugin from 'rollup-plugin-dts';

const external = [/^node:/, '@karmaniverous/jeeves-watcher-core'];

const typescript = typescriptPlugin({
  tsconfig: './tsconfig.json',
  outputToFilesystem: false,
  include: ['src/**/*.ts'],
  exclude: ['**/*.test.ts'],
  noEmit: false,
  declaration: false,
  declarationMap: false,
  incremental: false,
  // Type against the built core package, not the source path mapping
  // used by typecheck/tests (see tsconfig.json).
  paths: {},
});

/** ESM library output. */
const library: RollupOptions = {
  input: 'src/index.ts',
  external,
  output: [{ dir: 'dist', format: 'esm' }],
  plugins: [typescript],
};

/** Bundled .d.ts declarations (core types stay imported from core). */
const types: RollupOptions = {
  input: 'src/index.ts',
  external,
  output: [{ file: 'dist/index.d.ts', format: 'esm' }],
  plugins: [dtsPlugin({ compilerOptions: { paths: {} } })],
};

export default [library, types];
