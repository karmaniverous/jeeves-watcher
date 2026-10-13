/**
 * @module test/qdrant/assets
 * Pure release-asset table for the throwaway test Qdrant: pinned version, per-platform GitHub release archive names with SHA-256 digests, download URLs.
 * No I/O; {@link selectQdrantAsset} maps `process.platform`/`process.arch` to an asset (or `undefined` when unsupported).
 */

/** Qdrant version provisioned for tests; matches the CI service container image. */
export const QDRANT_VERSION = '1.19.1';

/** A downloadable Qdrant release archive. */
export interface QdrantAsset {
  /** Release asset file name. */
  name: string;
  /** Expected SHA-256 of the archive (lower-case hex). */
  sha256: string;
  /** File name of the executable inside the archive. */
  binaryName: string;
}

/** Release assets for {@link QDRANT_VERSION}, keyed by `${platform}-${arch}`. */
const ASSETS: Readonly<Record<string, QdrantAsset>> = {
  'win32-x64': {
    name: 'qdrant-x86_64-pc-windows-msvc.zip',
    sha256: '9b6f69bd85f6abed4bc13f943099f55c6ffd55f5dd90388635320d8fbb569eb0',
    binaryName: 'qdrant.exe',
  },
  'linux-x64': {
    name: 'qdrant-x86_64-unknown-linux-musl.tar.gz',
    sha256: '70a40529e2ebe0a2787d574d3a2e28437cfe94f26f24fa419f6ac57b4ae817c9',
    binaryName: 'qdrant',
  },
  'linux-arm64': {
    name: 'qdrant-aarch64-unknown-linux-musl.tar.gz',
    sha256: '0e607c11705fab22f7d667f4749bc0b6b60a8fa9e91de71880a6ebafbbda1b26',
    binaryName: 'qdrant',
  },
  'darwin-x64': {
    name: 'qdrant-x86_64-apple-darwin.tar.gz',
    sha256: 'ba7cbada9a90aefdbd7f92de4e093cd25328206bd65e9e96657bd6133d272637',
    binaryName: 'qdrant',
  },
  'darwin-arm64': {
    name: 'qdrant-aarch64-apple-darwin.tar.gz',
    sha256: 'e060209dfefc9d977ddcec48521349f505f8fd1ce21f2a3db444140870522fe4',
    binaryName: 'qdrant',
  },
};

/**
 * Select the release asset for a platform.
 *
 * @param platform - A `process.platform` value.
 * @param arch - A `process.arch` value.
 * @returns The asset, or `undefined` when no official binary exists for the platform.
 */
export function selectQdrantAsset(
  platform: string,
  arch: string,
): QdrantAsset | undefined {
  return ASSETS[`${platform}-${arch}`];
}

/**
 * GitHub release download URL of an asset.
 *
 * @param asset - The asset.
 * @param version - Qdrant version (default {@link QDRANT_VERSION}).
 * @returns The `https://github.com/qdrant/qdrant/releases/download/...` URL.
 */
export function qdrantAssetUrl(
  asset: QdrantAsset,
  version: string = QDRANT_VERSION,
): string {
  return `https://github.com/qdrant/qdrant/releases/download/v${version}/${asset.name}`;
}
