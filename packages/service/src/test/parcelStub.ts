/**
 * @module test/parcelStub
 * A stub `@parcel/watcher` that records every subscribe and unsubscribe in order and can fail either on demand, a sink of spies, and a spy logger, for the parcel source tests.
 */

import { type Mock, vi } from 'vitest';

import type {
  ParcelCallback,
  ParcelWatcherModule,
} from '../watcher/changeSource/parcelModule';
import type { ChangeSink } from '../watcher/changeSource/types';

/** A logger whose levels are spies. */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** A recorded subscription. */
export interface Sub {
  dir: string;
  callback: ParcelCallback;
  options: unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

/** A stub `@parcel/watcher` recording every call in order. */
export function stubParcel() {
  const subs: Sub[] = [];
  const log: string[] = [];
  const failNext: Error[] = [];
  const rejectUnsubscribe = new Set<string>();
  const parcel: ParcelWatcherModule = {
    subscribe: vi.fn((dir: string, callback: ParcelCallback, options) => {
      log.push(`subscribe ${dir}`);
      if (failNext.length > 0) return Promise.reject(failNext.shift()!);
      const sub: Sub = {
        dir,
        callback,
        options,
        unsubscribe: vi.fn(() => {
          log.push(`unsubscribe ${dir}`);
          return rejectUnsubscribe.has(dir)
            ? Promise.reject(new Error('Error unsubscribing'))
            : Promise.resolve();
        }),
      };
      subs.push(sub);
      return Promise.resolve({ unsubscribe: sub.unsubscribe });
    }) as unknown as ParcelWatcherModule['subscribe'],
  };
  /** The live subscription for a dir (the latest). */
  const latest = (dir: string) => subs.filter((s) => s.dir === dir).at(-1)!;
  return { parcel, subs, log, failNext, rejectUnsubscribe, latest };
}

/** A sink whose methods are spies. */
export function stubSink(): { [K in keyof ChangeSink]: ChangeSink[K] & Mock } {
  return {
    event: vi.fn(),
    rawEvents: vi.fn(),
    initialScanDone: vi.fn(),
    resubscribed: vi.fn(),
    rootUnavailable: vi.fn(),
    rootAvailable: vi.fn(),
  };
}
