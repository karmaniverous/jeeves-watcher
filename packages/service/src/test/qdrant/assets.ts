/**
 * @module test/qdrant/assets
 * Pure release-asset table for the throwaway test Qdrant: pinned version, per-platform GitHub release archive names with SHA-256 digests of the archive and of the extracted executable, download URLs.
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
  /**
   * Expected SHA-256 of the extracted executable (lower-case hex), so a
   * cached copy is re-verified on every use, not only when downloaded.
   */
  binarySha256: string;
}

/** Release assets for {@link QDRANT_VERSION}, keyed by `${platform}-${arch}`. */
const ASSETS: Readonly<Record<string, QdrantAsset>> = {
  'win32-x64': {
    name: 'qdrant-x86_64-pc-windows-msvc.zip',
    sha256: '9b6f69bd85f6abed4bc13f943099f55c6ffd55f5dd90388635320d8fbb569eb0',
    binaryName: 'qdrant.exe',
    binarySha256:
      'b5354e3c8f9d13d92294f38d4988d4ddedc04acaa2ce51f0a2d65b30e2d4cd69',
  },
  'linux-x64': {
    name: 'qdrant-x86_64-unknown-linux-musl.tar.gz',
    sha256: '70a40529e2ebe0a2787d574d3a2e28437cfe94f26f24fa419f6ac57b4ae817c9',
    binaryName: 'qdrant',
    binarySha256:
      '7951936099f2bdc05776f875f5b683fe49beeb8c8ad71e4ff7ae042e984efc83',
  },
  'linux-arm64': {
    name: 'qdrant-aarch64-unknown-linux-musl.tar.gz',
    sha256: '0e607c11705fab22f7d667f4749bc0b6b60a8fa9e91de71880a6ebafbbda1b26',
    binaryName: 'qdrant',
    binarySha256:
      '9c39363d33631b16b12e59a715d3d85e965c5f7795e907874ef0a44a052a8b58',
  },
  'darwin-x64': {
    name: 'qdrant-x86_64-apple-darwin.tar.gz',
    sha256: 'ba7cbada9a90aefdbd7f92de4e093cd25328206bd65e9e96657bd6133d272637',
    binaryName: 'qdrant',
    binarySha256:
      '9bb97320a447367fc9d1e2780255a8d8efdbb9d36de0eecfa7b65879aedd8a5d',
  },
  'darwin-arm64': {
    name: 'qdrant-aarch64-apple-darwin.tar.gz',
    sha256: 'e060209dfefc9d977ddcec48521349f505f8fd1ce21f2a3db444140870522fe4',
    binaryName: 'qdrant',
    binarySha256:
      '967ce05dac592ede582072f0c335f3c2d095dfe4dd21ab370b89d7d9158d6cc4',
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
