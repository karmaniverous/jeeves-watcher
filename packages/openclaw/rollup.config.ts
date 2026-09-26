/**
 * Rollup configuration for the OpenClaw plugin package.
 * Single entry point: the plugin (ESM + declarations).
 *
 * `@karmaniverous/jeeves` is externalized: it is a runtime dependency that
 * `openclaw plugins install` installs alongside the plugin.
 *
 * @module rollup.config
 */

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupLog, RollupOptions } from 'rollup';

const external: (string | RegExp)[] = [/^node:/, '@karmaniverous/jeeves'];

/**
 * Third-party noise from bundled dependencies (zod): comment annotations
 * Rollup cannot place, and zod's internal core ↔ util import cycle. Only
 * these codes, and only for modules under `node_modules`, are dropped; every
 * other warning is still reported.
 */
const isBundledDependencyNoise = (log: RollupLog): boolean =>
  (log.code === 'INVALID_ANNOTATION' &&
    (log.id ?? '').includes('node_modules')) ||
  (log.code === 'CIRCULAR_DEPENDENCY' &&
    (log.ids ?? []).every((id) => id.includes('node_modules')));

const pluginConfig: RollupOptions = {
  onwarn: (log, warn) => {
    if (!isBundledDependencyNoise(log)) warn(log);
  },
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

export default [pluginConfig];
