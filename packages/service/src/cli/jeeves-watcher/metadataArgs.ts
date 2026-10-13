/**
 * @module cli/jeeves-watcher/metadataArgs
 * Parses the `enrich` command's --json and --key options into a metadata object; reports validation errors on stderr and sets the exit code.
 */

/**
 * Parse `--json` and `--key` options into a metadata object.
 *
 * @param json - Metadata as a JSON string, if given.
 * @param keys - `key=value` pairs (applied after `json`).
 * @returns The metadata, or `null` on validation failure (already reported).
 */
export function parseMetadataArgs(
  json: string | undefined,
  keys: string[],
): Record<string, unknown> | null {
  let metadata: Record<string, unknown> = {};

  if (json) {
    try {
      metadata = JSON.parse(json) as Record<string, unknown>;
    } catch {
      console.error('Invalid JSON:', json);
      process.exitCode = 1;
      return null;
    }
  }

  if (Array.isArray(keys) && keys.length > 0) {
    for (const pair of keys) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        console.error(`Invalid key-value pair: ${pair}`);
        process.exitCode = 1;
        return null;
      }
      metadata[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
    }
  }

  if (Object.keys(metadata).length === 0) {
    console.error('No metadata provided. Use --key or --json.');
    process.exitCode = 1;
    return null;
  }

  return metadata;
}
