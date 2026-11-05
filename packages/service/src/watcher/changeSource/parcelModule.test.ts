/**
 * @module watcher/changeSource/parcelModule.test
 * Loading `@parcel/watcher` (D125, D156): the refusal message names the chokidar switch, native-load errors are told apart from subscription errors, the backend is explicit per platform, and the real module loads on this platform.
 */

import { describe, expect, it } from 'vitest';

import {
  ChangeSourceLoadError,
  isNativeLoadError,
  loadParcelWatcher,
  parcelBackend,
} from './parcelModule';

/** An Error with a `code`. */
function coded(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

describe('loadParcelWatcher', () => {
  it('loads the real module on this platform', async () => {
    const parcel = await loadParcelWatcher();
    expect(typeof parcel.subscribe).toBe('function');
  });

  it('turns an import failure into a refusal naming the switch', async () => {
    const failing = loadParcelWatcher(() =>
      Promise.reject(coded('Cannot find module', 'MODULE_NOT_FOUND')),
    );
    await expect(failing).rejects.toBeInstanceOf(ChangeSourceLoadError);
    await expect(failing).rejects.toThrow(
      "watch.changeSource 'parcel': @parcel/watcher failed to load (MODULE_NOT_FOUND). Reinstall the service, or set watch.changeSource: chokidar.",
    );
  });

  it('names the error type when the failure has no code', async () => {
    await expect(
      loadParcelWatcher(() => Promise.reject(new TypeError('boom'))),
    ).rejects.toThrow('failed to load (TypeError)');
    await expect(
      loadParcelWatcher(() => Promise.reject(new Error('plain'))),
    ).rejects.toThrow('failed to load (Error)');
  });

  it('names a non-Error cause', () => {
    expect(new ChangeSourceLoadError('nope').message).toContain(
      'failed to load (UnknownError)',
    );
  });

  it('keeps the cause', async () => {
    const cause = coded('dlopen failed', 'ERR_DLOPEN_FAILED');
    const error = await loadParcelWatcher(() => Promise.reject(cause)).catch(
      (e: unknown) => e,
    );
    expect((error as ChangeSourceLoadError).cause).toBe(cause);
    expect((error as ChangeSourceLoadError).code).toBe('ERR_DLOPEN_FAILED');
  });
});

describe('isNativeLoadError', () => {
  it.each([
    [new ChangeSourceLoadError(new Error('x')), true],
    [coded('x', 'ERR_DLOPEN_FAILED'), true],
    [coded('x', 'MODULE_NOT_FOUND'), true],
    [
      new Error(
        'No prebuild or local build of @parcel/watcher found. Tried @parcel/watcher-win32-x64.',
      ),
      true,
    ],
    [
      new Error('\\\\?\\C:\\x\\watcher.node is not a valid Win32 application.'),
      true,
    ],
    [coded('inotify_add_watch on /x failed: No space left on device'), false],
    [coded('ENOENT: no such file or directory', 'ENOENT'), false],
    [new Error('Error starting watcher'), false],
    ['a string', false],
  ])('%s -> %s', (error, expected) => {
    expect(isNativeLoadError(error)).toBe(expected);
  });
});

describe('parcelBackend', () => {
  it.each([
    ['win32', 'windows'],
    ['linux', 'inotify'],
    ['darwin', 'fs-events'],
  ] as const)('%s -> %s (never watchman)', (platform, backend) => {
    expect(parcelBackend(platform)).toBe(backend);
  });

  it('refuses any other platform, naming the switch', () => {
    expect(() => parcelBackend('freebsd')).toThrow(
      '@parcel/watcher failed to load (EPLATFORM). Reinstall the service, or set watch.changeSource: chokidar.',
    );
  });
});
