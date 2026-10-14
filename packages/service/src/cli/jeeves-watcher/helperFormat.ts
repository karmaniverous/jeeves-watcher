/**
 * @module cli/jeeves-watcher/helperFormat
 * Pure formatting for the `helpers` CLI command: renders JsonMap and Handlebars helper namespaces from GET /config query results as text.
 */

/** A configured helper namespace as returned by the config query. */
export interface HelperEntry {
  path?: string;
  description?: string;
  exports?: Record<string, string>;
}

/** Shape of a `GET /config?path=...` response. */
export interface QueryResult {
  result: unknown[];
  count: number;
}

/**
 * Format a helpers section for display. Pure.
 *
 * @param title - Section heading.
 * @param data - Helper namespaces keyed by name.
 * @returns The rendered section, or `''` when there are no helpers.
 */
export function formatHelperSection(
  title: string,
  data: Record<string, HelperEntry> | undefined,
): string {
  if (!data || Object.keys(data).length === 0) return '';

  const lines: string[] = [`${title}:`];
  for (const [namespace, entry] of Object.entries(data)) {
    if (entry.description) {
      lines.push(`  [${namespace}] ${entry.description}`);
    }
    if (entry.exports) {
      for (const [name, desc] of Object.entries(entry.exports)) {
        const descPart = desc ? ` - ${desc}` : '';
        lines.push(`  ${name.padEnd(40)}${descPart}`);
      }
    } else {
      lines.push(`  (no exports introspected)`);
    }
  }
  return lines.join('\n');
}
