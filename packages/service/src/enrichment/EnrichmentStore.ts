/**
 * @module enrichment/EnrichmentStore
 * SQLite-backed enrichment metadata store. Persists path-keyed metadata at stateDir/enrichments.sqlite. Atomic writes, supports move.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type pino from 'pino';

import { normalizePath } from '../util/normalizePath';

const BUSY_TIMEOUT_MS = 5000;

/**
 * Interface for enrichment metadata persistence.
 */
export interface EnrichmentStoreInterface {
  /** Get enrichment metadata for a file path, or null. */
  get(path: string): Record<string, unknown> | null;

  /** Set/merge enrichment metadata for a file path. */
  set(path: string, metadata: Record<string, unknown>): void;

  /** Delete enrichment metadata for a file path. */
  delete(path: string): void;

  /** Move enrichment from old path to new path (atomic). */
  move(oldPath: string, newPath: string): void;

  /** List all enriched paths (for diagnostics). */
  list(): string[];

  /** Close the database connection. */
  close(): void;
}

/**
 * SQLite-backed enrichment metadata store.
 */
export class EnrichmentStore implements EnrichmentStoreInterface {
  private readonly db: Database.Database;
  private readonly logger?: pino.Logger;

  /**
   * Create or open the enrichment store.
   *
   * @param stateDir - Directory for the SQLite database file.
   */
  constructor(stateDir: string, logger?: pino.Logger) {
    this.logger = logger;
    mkdirSync(stateDir, { recursive: true });
    const dbPath = join(stateDir, 'enrichments.sqlite');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = ' + BUSY_TIMEOUT_MS.toString());

    const [checkpointStatus] = this.db.pragma(
      'wal_checkpoint(TRUNCATE)',
    ) as Array<
      | {
          busy: number;
          log: number;
          checkpointed: number;
        }
      | undefined
    >;

    if (checkpointStatus && checkpointStatus.busy > 0) {
      // EnrichmentStore is expected to be single-writer. If we see a busy WAL
      // checkpoint at startup, it's most likely from an unclean shutdown where
      // the OS hasn't yet released file handles.
      this.logger?.warn(
        { checkpointStatus },
        'WAL checkpoint busy at startup; OS may still be releasing file handles',
      );
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrichments (
        path TEXT PRIMARY KEY,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  get(path: string): Record<string, unknown> | null {
    const normalized = normalizePath(path);
    const row = this.db
      .prepare('SELECT metadata FROM enrichments WHERE path = ?')
      .get(normalized) as { metadata: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.metadata) as Record<string, unknown>;
  }

  set(path: string, metadata: Record<string, unknown>): void {
    const normalized = normalizePath(path);
    const now = new Date().toISOString();
    const existing = this.get(path);
    const merged = existing ? { ...existing, ...metadata } : metadata;
    const json = JSON.stringify(merged);

    if (existing) {
      this.db
        .prepare(
          'UPDATE enrichments SET metadata = ?, updated_at = ? WHERE path = ?',
        )
        .run(json, now, normalized);
    } else {
      this.db
        .prepare(
          'INSERT INTO enrichments (path, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run(normalized, json, now, now);
    }
  }

  delete(path: string): void {
    const normalized = normalizePath(path);
    this.db.prepare('DELETE FROM enrichments WHERE path = ?').run(normalized);
  }

  move(oldPath: string, newPath: string): void {
    const normalizedOld = normalizePath(oldPath);
    const normalizedNew = normalizePath(newPath);
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE enrichments SET path = ?, updated_at = ? WHERE path = ?')
      .run(normalizedNew, now, normalizedOld);
  }

  list(): string[] {
    const rows = this.db
      .prepare('SELECT path FROM enrichments ORDER BY path')
      .all() as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  close(): void {
    this.db.close();
  }
}
