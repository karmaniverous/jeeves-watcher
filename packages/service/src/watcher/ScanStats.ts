/**
 * @module watcher/ScanStats
 * Tracks initial filesystem scan statistics for diagnostics.
 */

/**
 * Mutable counter bag updated during the chokidar initial scan.
 * Extracted from the watcher start() method for clarity.
 */
export class ScanStats {
  total = 0;
  matched = 0;
  globRejected = 0;
  gitignored = 0;
  readonly byRoot: Record<string, number>;

  constructor(roots: string[]) {
    this.byRoot = Object.fromEntries(roots.map((r) => [r, 0]));
  }

  /**
   * Attribute a newly discovered file to its root for per-root diagnostics.
   */
  classifyByRoot(path: string): void {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    for (const root of Object.keys(this.byRoot)) {
      if (normalized.startsWith(`${root}/`) || normalized === root) {
        this.byRoot[root] = (this.byRoot[root] ?? 0) + 1;
        break;
      }
    }
  }
}
