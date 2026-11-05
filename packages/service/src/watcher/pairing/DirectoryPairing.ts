/**
 * @module watcher/pairing/DirectoryPairing
 * Order-independent directory pairing (C3, D62, D149, D150): a directory delete and a directory create seen within `moveDetection.bufferMs` of each other, in either order, are one move when at least 90% of the deleted subtree's files reappear under the created directory at the same relative path and size. Pure apart from the injected walk and timers; every resolution runs in the batch queue.
 */

import type pino from 'pino';

import { keyWithin, normalizeDocumentKey } from '../../util/documentKey';
import type { FileStats } from '../inventory/Inventory';
import type { WalkedFile } from '../walk/Walker';

/** The share of the deleted subtree that must reappear (D62). */
export const PAIRING_MATCH_RATIO = 0.9;

/** What pairing needs from `FileSystemWatcher`. */
export interface PairingDeps {
  bufferMs: number;
  /** The inventory's files under a directory, keyed by document key (D150). */
  entriesUnder: (dir: string) => Map<string, { path: string } & Partial<FileStats>>;
  /** Drop a file from the inventory while its directory delete is held. */
  forget: (path: string) => void;
  /** Walk a created directory: matched files with their stats. */
  walk: (dir: string) => Promise<Map<string, WalkedFile>>;
  /** Unlink a file (normal handler). */
  unlink: (path: string) => void;
  /** Move a file (normal handler, D62). */
  move: (oldPath: string, newPath: string, stats: FileStats) => void;
  /** Start (or join) a file's stability wait. */
  enterStability: (path: string) => void;
  /** Cancel stability waits at and under a directory. */
  dropStability: (dir: string) => void;
  /** Reconcile a directory. */
  reconcile: (dir: string) => void;
  /** Run work in the batch queue after the current batch (timers). */
  schedule: (work: () => Promise<void> | void) => void;
  logger: pino.Logger;
}

/** A held directory delete: its subtree snapshot by relative key. */
interface HeldDelete {
  path: string;
  key: string;
  files: Map<string, { path: string; size?: number }>;
  timer: ReturnType<typeof setTimeout>;
}

/** A held directory create and the file events buffered under it. */
interface HeldCreate {
  path: string;
  key: string;
  buffered: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/** `key` relative to `dirKey` (a key under it). */
function relativeKey(key: string, dirKey: string): string {
  return key.slice(dirKey.length + 1);
}

/** Pairs directory deletes with directory creates (D62). */
export class DirectoryPairing {
  private readonly deletes = new Map<string, HeldDelete>();
  private readonly creates = new Map<string, HeldCreate>();

  /** @param deps - Inventory access, walk, handlers, queue. */
  constructor(private readonly deps: PairingDeps) {}

  /** Directories held, for tests and diagnostics. */
  get held(): { deletes: number; creates: number } {
    return { deletes: this.deletes.size, creates: this.creates.size };
  }

  /**
   * Whether a file event at `path` falls under a held create (it is
   * buffered there instead of handled, D62).
   *
   * @param path - A present file.
   * @returns True when buffered.
   */
  buffer(path: string): boolean {
    const key = normalizeDocumentKey(path);
    for (const held of this.creates.values()) {
      if (keyWithin(key, held.key)) {
        held.buffered.add(path);
        return true;
      }
    }
    return false;
  }

  /**
   * A directory the inventory held is gone: snapshot its subtree from the
   * child sets (D150), take it out of the inventory, then pair it with a
   * held create or hold it.
   *
   * @param path - The directory.
   */
  async deleted(path: string): Promise<void> {
    const key = normalizeDocumentKey(path);
    const files = new Map<string, { path: string; size?: number }>();
    for (const [fileKey, entry] of this.deps.entriesUnder(path)) {
      files.set(relativeKey(fileKey, key), entry);
      this.deps.forget(entry.path);
    }
    this.deps.dropStability(path);
    const held: HeldDelete = {
      path,
      key,
      files,
      timer: this.hold(() => {
        this.expireDelete(key);
      }),
    };
    this.deletes.set(key, held);
    for (const create of [...this.creates.values()]) {
      if (await this.tryPair(held, create)) return;
    }
  }

  /**
   * A directory was created: pair it with a held delete or hold it.
   *
   * @param path - The directory.
   */
  async created(path: string): Promise<void> {
    const key = normalizeDocumentKey(path);
    if (this.creates.has(key)) return;
    const held: HeldCreate = {
      path,
      key,
      buffered: new Set(),
      timer: this.hold(() => {
        this.expireCreate(key);
      }),
    };
    this.creates.set(key, held);
    for (const deleted of [...this.deletes.values()]) {
      if (await this.tryPair(deleted, held)) return;
    }
  }

  /** Clear every hold without resolving it (the watcher is stopping). */
  stop(): void {
    for (const held of [...this.deletes.values(), ...this.creates.values()]) {
      clearTimeout(held.timer);
    }
    this.deletes.clear();
    this.creates.clear();
  }

  /** A hold timer whose expiry runs in the batch queue. */
  private hold(expire: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.deps.schedule(expire);
    }, this.deps.bufferMs);
    timer.unref();
    return timer;
  }

  /**
   * Walk Q and pair when at least 90% of P's files reappear at the same
   * relative path and size. Both holds end on a pairing.
   *
   * @returns True when paired.
   */
  private async tryPair(deleted: HeldDelete, created: HeldCreate): Promise<boolean> {
    if (!this.deletes.has(deleted.key) || !this.creates.has(created.key)) {
      return false;
    }
    const walked = await this.deps.walk(created.path).catch((error: unknown) => {
      this.deps.logger.warn({ dir: created.path, error }, 'Pairing walk failed');
      return new Map<string, WalkedFile>();
    });
    const byRelative = new Map<string, WalkedFile>();
    for (const [fileKey, file] of walked) {
      byRelative.set(relativeKey(fileKey, created.key), file);
    }
    const matched = [...deleted.files].filter(([relative, entry]) => {
      const file = byRelative.get(relative);
      return file !== undefined && (entry.size === undefined || entry.size === file.size);
    });
    if (matched.length < deleted.files.size * PAIRING_MATCH_RATIO) return false;
    if (!this.deletes.has(deleted.key) || !this.creates.has(created.key)) {
      return false;
    }
    this.release(deleted);
    this.release(created);
    this.deps.logger.info(
      { from: deleted.path, to: created.path, files: matched.length },
      'Directory move paired',
    );
    this.deps.dropStability(created.path);
    const moved = new Set<string>();
    for (const [relative, entry] of matched) {
      const file = byRelative.get(relative)!;
      moved.add(relative);
      this.deps.move(entry.path, file.path, { size: file.size, mtimeMs: file.mtimeMs });
    }
    for (const [relative, entry] of deleted.files) {
      if (!moved.has(relative)) this.deps.unlink(entry.path);
    }
    for (const [relative, file] of byRelative) {
      if (!moved.has(relative)) this.deps.enterStability(file.path);
    }
    // A buffered event the move covers settles against the walk's stats:
    // equal is dropped, different is a change (D142).
    for (const path of created.buffered) this.deps.enterStability(path);
    return true;
  }

  private release(held: HeldDelete | HeldCreate): void {
    clearTimeout(held.timer);
    if ('files' in held) this.deletes.delete(held.key);
    else this.creates.delete(held.key);
  }

  /** An unpaired delete: every file of the subtree is unlinked. */
  private expireDelete(key: string): void {
    const held = this.deletes.get(key);
    if (!held) return;
    this.release(held);
    for (const entry of held.files.values()) this.deps.unlink(entry.path);
  }

  /** An unpaired create: reconcile it, then its buffered events. */
  private expireCreate(key: string): void {
    const held = this.creates.get(key);
    if (!held) return;
    this.release(held);
    this.deps.reconcile(held.path);
    for (const path of held.buffered) this.deps.enterStability(path);
  }
}
