/**
 * @module helpers/loadModule.test
 * Tests for module loading utilities.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNamespacedExports } from './loadModule';

describe('loadNamespacedExports', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-loadmodule-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup handled by OS tmp cleanup
  });

  it('should load named exports from a module', async () => {
    const modulePath = join(testDir, 'helpers.js');
    await writeFile(
      modulePath,
      `
      export function add(a, b) { return a + b; }
      export function multiply(a, b) { return a * b; }
      export const nonFunction = 'value';
    `,
    );

    const result = await loadNamespacedExports(
      { math: { path: modulePath } },
      '',
    );

    expect(result.math).toBeDefined();
    expect(result.math.add).toBeTypeOf('function');
    expect(result.math.multiply).toBeTypeOf('function');
    expect(result.math.nonFunction).toBe('value');
  });

  it('should load default export if it is an object', async () => {
    const modulePath = join(testDir, 'defaultObj.js');
    await writeFile(
      modulePath,
      `
      export default {
        foo: () => 'bar',
        baz: 42
      };
    `,
    );

    const result = await loadNamespacedExports(
      { util: { path: modulePath } },
      '',
    );

    expect(result.util.foo).toBeTypeOf('function');
    expect(result.util.baz).toBe(42);
  });

  it('should filter exports using the filter predicate', async () => {
    const modulePath = join(testDir, 'mixed.js');
    await writeFile(
      modulePath,
      `
      export function fn1() {}
      export const value = 'test';
      export function fn2() {}
    `,
    );

    const result = await loadNamespacedExports(
      { helpers: { path: modulePath } },
      '',
      (val) => typeof val === 'function',
    );

    expect(result.helpers.fn1).toBeTypeOf('function');
    expect(result.helpers.fn2).toBeTypeOf('function');
    expect(result.helpers.value).toBeUndefined();
  });

  it('should handle multiple namespaces', async () => {
    const module1Path = join(testDir, 'module1.js');
    const module2Path = join(testDir, 'module2.js');

    await writeFile(module1Path, `export const x = 1;`);
    await writeFile(module2Path, `export const y = 2;`);

    const result = await loadNamespacedExports(
      {
        ns1: { path: module1Path },
        ns2: { path: module2Path },
      },
      '',
    );

    expect(result.ns1.x).toBe(1);
    expect(result.ns2.y).toBe(2);
  });

  it('should resolve relative paths against configDir', async () => {
    const subDir = join(testDir, 'subdir');
    await mkdir(subDir, { recursive: true });
    const modulePath = join(subDir, 'helper.js');
    await writeFile(modulePath, `export const value = 'loaded';`);

    const result = await loadNamespacedExports(
      { test: { path: 'subdir/helper.js' } },
      testDir,
    );

    expect(result.test.value).toBe('loaded');
  });
});
