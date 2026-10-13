/**
 * @module test/qdrant/launch.test
 * Tests for the pure launch settings of both provisioning paths: the release binary's child environment and the Docker run arguments.
 */

import { join, resolve, toNamespacedPath } from 'node:path';

import { describe, expect, it } from 'vitest';

import { qdrantChildEnv } from './binary';
import { dockerRunArgs, QDRANT_IMAGE } from './docker';

describe('qdrantChildEnv', () => {
  const dir = join('tmp', 'q');
  const env = qdrantChildEnv(dir, 51000, 51001);

  it('binds loopback on the given ports', () => {
    expect(env['QDRANT__SERVICE__HOST']).toBe('127.0.0.1');
    expect(env['QDRANT__SERVICE__HTTP_PORT']).toBe('51000');
    expect(env['QDRANT__SERVICE__GRPC_PORT']).toBe('51001');
  });

  it('keeps all state inside the temp dir and disables telemetry', () => {
    const inDir = (leaf: string) => toNamespacedPath(join(dir, leaf));
    expect(env['QDRANT__STORAGE__STORAGE_PATH']).toBe(inDir('storage'));
    expect(env['QDRANT__STORAGE__SNAPSHOTS_PATH']).toBe(inDir('snapshots'));
    expect(env['QDRANT__STORAGE__TEMP_PATH']).toBe(inDir('tmp'));
    expect(env['QDRANT__TELEMETRY_DISABLED']).toBe('true');
  });

  it.runIf(process.platform === 'win32')(
    'uses long-path-safe (namespaced) storage paths on Windows',
    () => {
      expect(env['QDRANT__STORAGE__STORAGE_PATH']).toBe(
        `\\\\?\\${resolve(dir, 'storage')}`,
      );
    },
  );
});

describe('dockerRunArgs', () => {
  it('runs the pinned image detached, removed, on a random loopback port', () => {
    expect(QDRANT_IMAGE).toBe('qdrant/qdrant:v1.19.1');
    const args = dockerRunArgs();
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-d']);
    expect(args).toContain('127.0.0.1::6333');
    expect(args.at(-1)).toBe(QDRANT_IMAGE);
  });
});
