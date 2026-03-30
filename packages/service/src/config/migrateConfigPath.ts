/**
 * @module config/migrateConfigPath
 *
 * Auto-migrates legacy flat config path (`jeeves-watcher.config.json`)
 * to the new namespaced convention (`jeeves-watcher/config.json`).
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface MigrateConfigResult {
  /** The resolved config path to load. */
  configPath: string;
  /** Whether a migration was performed. */
  migrated: boolean;
  /** Warning message if both old and new paths exist. */
  warning?: string;
}

const OLD_FILENAME = 'jeeves-watcher.config.json';
const NEW_DIR = 'jeeves-watcher';
const NEW_FILENAME = 'config.json';

/**
 * Resolve the config path, migrating from old to new convention if needed.
 *
 * When `configDir` is provided (the directory to search for config), the
 * function checks for the old flat file and the new namespaced directory.
 *
 * Migration only runs when using the default/conventional path — an explicit
 * `-c` flag bypasses this entirely.
 *
 * @param configDir - The directory to search for config files.
 * @returns The resolved config path and migration metadata.
 * @throws If neither old nor new config path exists.
 */
export function migrateConfigPath(configDir: string): MigrateConfigResult {
  const oldPath = join(configDir, OLD_FILENAME);
  const newDir = join(configDir, NEW_DIR);
  const newPath = join(newDir, NEW_FILENAME);

  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);

  if (newExists && oldExists) {
    return {
      configPath: newPath,
      migrated: false,
      warning: `Both legacy config (${oldPath}) and new config (${newPath}) exist. Using new path. Consider removing the legacy file.`,
    };
  }

  if (newExists) {
    return { configPath: newPath, migrated: false };
  }

  if (oldExists) {
    mkdirSync(newDir, { recursive: true });
    renameSync(oldPath, newPath);
    return { configPath: newPath, migrated: true };
  }

  throw new Error(
    `No jeeves-watcher configuration found in ${configDir}. ` +
      `Expected ${newPath} or ${oldPath}.`,
  );
}

/**
 * Return the default config directory.
 *
 * Falls back to the working directory when no conventional config root is set.
 * On the Jeeves platform the config root is typically passed via the `-c` flag
 * pointing directly at the file, so this helper is only used for the
 * migration/discovery flow.
 *
 * @param explicitConfigPath - If the user passed `-c`, return its dirname.
 * @returns The directory to search for config files.
 */
export function resolveConfigDir(explicitConfigPath?: string): string {
  if (explicitConfigPath) {
    return dirname(explicitConfigPath);
  }
  return process.cwd();
}
