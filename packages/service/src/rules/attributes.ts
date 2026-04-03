/**
 * @module rules/attributes
 * Builds file attribute objects for rule matching. Pure function: derives attributes from path, stats, and extracted data.
 */

import type { Stats } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';

/**
 * Attributes derived from a watched file for rule matching.
 */
export interface FileAttributes {
  /** File-level properties. */
  file: {
    /** Full file path (forward slashes). */
    path: string;
    /** Directory containing the file. */
    directory: string;
    /** File name with extension. */
    filename: string;
    /** File extension including the leading dot. */
    extension: string;
    /** File size in bytes. */
    sizeBytes: number;
    /** ISO-8601 last-modified timestamp. */
    modified: string;
  };
  /** Extracted YAML frontmatter, if any. */
  frontmatter?: Record<string, unknown>;
  /** Parsed JSON content, if any. */
  json?: Record<string, unknown>;
}

/** Derive the path-based file properties shared by all attribute builders. */
function buildFileProps(filePath: string) {
  const normalised = normalizeSlashes(filePath);
  return {
    path: normalised,
    directory: normalizeSlashes(dirname(normalised)),
    filename: basename(normalised),
    extension: extname(normalised),
  };
}

/**
 * Build {@link FileAttributes} from a file path and stat info.
 *
 * @param filePath - The file path.
 * @param stats - The file stats.
 * @param extractedFrontmatter - Optional extracted frontmatter.
 * @param extractedJson - Optional parsed JSON content.
 * @returns The constructed file attributes.
 */
export function buildAttributes(
  filePath: string,
  stats: Stats,
  extractedFrontmatter?: Record<string, unknown>,
  extractedJson?: Record<string, unknown>,
): FileAttributes {
  const attrs: FileAttributes = {
    file: {
      ...buildFileProps(filePath),
      sizeBytes: stats.size,
      modified: stats.mtime.toISOString(),
    },
  };
  if (extractedFrontmatter) attrs.frontmatter = extractedFrontmatter;
  if (extractedJson) attrs.json = extractedJson;
  return attrs;
}

/**
 * Build synthetic file attributes from a path string (no actual file I/O).
 * Used by API handlers that need to match rules against paths without reading files.
 *
 * @param filePath - The file path.
 * @returns Synthetic file attributes with zeroed stats.
 */
export function buildSyntheticAttributes(filePath: string): FileAttributes {
  return {
    file: {
      ...buildFileProps(filePath),
      sizeBytes: 0,
      modified: new Date(0).toISOString(),
    },
  };
}
