/**
 * @module watcher/changeSource/parcelModule
 * Loading `@parcel/watcher` only when it is selected (D125): a cached dynamic import whose failure becomes a refusal naming the chokidar switch, the native-load error test, and the explicit backend per platform (D124). I/O: the import.
 */

import type ParcelWatcher from '@parcel/watcher';

/** The parts of `@parcel/watcher` the parcel source uses. */
export type ParcelWatcherModule = Pick<typeof ParcelWatcher, 'subscribe'>;

/** A parcel subscription handle (`AsyncSubscription`). */
export type ParcelSubscription = ParcelWatcher.AsyncSubscription;

/** A parcel subscription callback. */
export type ParcelCallback = ParcelWatcher.SubscribeCallback;

/** The backends the service selects explicitly (never watchman, D124). */
export type ParcelBackend = 'windows' | 'inotify' | 'fs-events';

/** Imports the module (injectable for tests). */
export type ParcelImporter = () => Promise<ParcelWatcherModule>;

/**
 * The selected change source cannot run: `@parcel/watcher` (or its native
 * binding) failed to load. The service refuses to start, and a reload
 * refuses the rebuild (D125, D156).
 */
export class ChangeSourceLoadError extends Error {
  /** The underlying error's code (or its name). */
  readonly code: string;

  /** @param cause - The import or binding error. */
  constructor(cause: unknown) {
    const code = errorCode(cause);
    super(
      `watch.changeSource 'parcel': @parcel/watcher failed to load (${code}). Reinstall the service, or set watch.changeSource: chokidar.`,
      { cause },
    );
    this.name = 'ChangeSourceLoadError';
    this.code = code;
  }
}

/** An error's `code`, else its name. */
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const { code } = error as NodeJS.ErrnoException;
    return typeof code === 'string' ? code : error.name;
  }
  return 'UnknownError';
}

/**
 * Whether an error means the native binding could not be loaded (a
 * missing or broken prebuild), as opposed to a subscription failure.
 *
 * @param error - Any error.
 * @returns True for a native-module load failure.
 */
export function isNativeLoadError(error: unknown): boolean {
  if (error instanceof ChangeSourceLoadError) return true;
  if (!(error instanceof Error)) return false;
  const { code } = error as NodeJS.ErrnoException;
  if (code === 'ERR_DLOPEN_FAILED' || code === 'MODULE_NOT_FOUND') return true;
  return /No prebuild or local build of @parcel\/watcher|watcher\.node/.test(
    error.message,
  );
}

/**
 * The explicit parcel backend for a platform (D124): `windows` on win32,
 * `inotify` on linux, `fs-events` on darwin.
 *
 * @param platform - `process.platform`.
 * @returns The backend.
 * @throws ChangeSourceLoadError on any other platform.
 */
export function parcelBackend(
  platform: NodeJS.Platform = process.platform,
): ParcelBackend {
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'inotify';
  if (platform === 'darwin') return 'fs-events';
  const error = new Error(`unsupported platform ${platform}`) as Error & {
    code: string;
  };
  error.code = 'EPLATFORM';
  throw new ChangeSourceLoadError(error);
}

/** Imports the real `@parcel/watcher` (the app's default factory). */
export const importParcelWatcher: ParcelImporter = async () =>
  (await import('@parcel/watcher')).default;

/**
 * Import `@parcel/watcher`. Node caches the module, so the app's import
 * before listening and every later one share it.
 *
 * @param importer - The import (default: the real module).
 * @returns The module.
 * @throws ChangeSourceLoadError when it cannot load.
 */
export async function loadParcelWatcher(
  importer: ParcelImporter = importParcelWatcher,
): Promise<ParcelWatcherModule> {
  try {
    parcelBackend();
    return await importer();
  } catch (error) {
    throw error instanceof ChangeSourceLoadError
      ? error
      : new ChangeSourceLoadError(error);
  }
}
