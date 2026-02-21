/**
 * @module writeJsonFile
 *
 * Utility for writing pretty-printed JSON from CLI commands.
 */

import { writeFile } from 'node:fs/promises';

/**
 * Write JSON to a file with stable formatting.
 *
 * @param path - Destination path.
 * @param data - JSON-serializable data.
 */
export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
