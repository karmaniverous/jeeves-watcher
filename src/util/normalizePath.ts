/**
 * @module util/normalizePath
 * Normalizes file paths for deterministic mapping: lowercase, forward slashes, optional drive letter stripping.
 */

/**
 * Normalize a file path: lowercase, forward slashes, optionally strip drive letter colon.
 *
 * @param filePath - The original file path.
 * @param stripDriveLetter - Whether to strip the colon from a leading drive letter (e.g. `C:` → `c`).
 * @returns The normalized path string.
 */
export function normalizePath(
  filePath: string,
  stripDriveLetter = false,
): string {
  let result = filePath.replace(/\\/g, '/').toLowerCase();
  if (stripDriveLetter) {
    result = result.replace(/^([a-z]):/, (_m, letter: string) => letter);
  }
  return result;
}
