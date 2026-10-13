/**
 * @module test/qdrant/assets.test
 * Tests for release-asset selection per platform and download URLs.
 */

import { describe, expect, it } from 'vitest';

import { QDRANT_VERSION, qdrantAssetUrl, selectQdrantAsset } from './assets';

describe('selectQdrantAsset', () => {
  it.each([
    ['win32', 'x64', 'qdrant-x86_64-pc-windows-msvc.zip', 'qdrant.exe'],
    ['linux', 'x64', 'qdrant-x86_64-unknown-linux-musl.tar.gz', 'qdrant'],
    ['linux', 'arm64', 'qdrant-aarch64-unknown-linux-musl.tar.gz', 'qdrant'],
    ['darwin', 'x64', 'qdrant-x86_64-apple-darwin.tar.gz', 'qdrant'],
    ['darwin', 'arm64', 'qdrant-aarch64-apple-darwin.tar.gz', 'qdrant'],
  ])('%s-%s -> %s', (platform, arch, name, binaryName) => {
    const asset = selectQdrantAsset(platform, arch);
    expect(asset?.name).toBe(name);
    expect(asset?.binaryName).toBe(binaryName);
    expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['win32', 'arm64'],
    ['linux', 'ia32'],
    ['freebsd', 'x64'],
    ['aix', 'ppc64'],
  ])('%s-%s is unsupported', (platform, arch) => {
    expect(selectQdrantAsset(platform, arch)).toBeUndefined();
  });
});

describe('qdrantAssetUrl', () => {
  it('points at the pinned GitHub release', () => {
    const asset = selectQdrantAsset('linux', 'x64')!;
    expect(qdrantAssetUrl(asset)).toBe(
      `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz`,
    );
  });

  it('pins the CI image version', () => {
    expect(QDRANT_VERSION).toBe('1.19.1');
  });
});
