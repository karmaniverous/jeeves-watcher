/**
 * @module watcher/changeSource/ParcelSource
 * The `@parcel/watcher` change source (C2, D124): one subscription per top root, whole batches to `FileSystemWatcher` (D149), a walk-based initial set (D58), Linux renewal with a sentinel rebuild (D129, D165, D176) and none on Windows (D177). Every parcel call runs in one serial queue. I/O: parcel subscriptions, the sentinel directory.
 */

import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';
import { parcelIgnore } from './parcelIgnore';
import {
  ChangeSourceLoadError,
  isNativeLoadError,
  parcelBackend,
  type ParcelWatcherModule,
} from './parcelModule';
import {
  RootSubscription,
  type SubscriptionContext,
} from './parcelSubscription';
import type { ChangeSink, ChangeSource, RenewResult } from './types';

/** {@link ParcelSource} options. */
export interface ParcelSourceOptions {
  /** The loaded module (D125: imported before the service listens). */
  parcel: ParcelWatcherModule;
  /** `watch.ignored`, rewritten per root (D156). */
  ignored: readonly string[];
  /** The service's state directory; the rebuild sentinel lives under it. */
  stateDir: string;
  logger: pino.Logger;
  /** `process.platform` (tests). */
  platform?: NodeJS.Platform;
  /** `lstat` (tests). */
  lstat?: (path: string) => Promise<unknown>;
}

/** The directory the sentinel subscription watches during a rebuild (D165). */
export const SENTINEL_DIR = 'parcel-sentinel';

/** A change source over `@parcel/watcher` (C2). */
export class ParcelSource implements ChangeSource {
  readonly name = 'parcel';
  readonly initialSet = 'walk' as const;
  private readonly subscriptions = new Map<string, RootSubscription>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly platform: NodeJS.Platform;
  private readonly lstat: (path: string) => Promise<unknown>;

  /** @param options - Module, ignore list, state dir, logger. */
  constructor(private readonly options: ParcelSourceOptions) {
    this.platform = options.platform ?? process.platform;
    this.lstat = options.lstat ?? lstat;
  }

  /**
   * Subscribe every root. A root whose first subscribe fails takes the
   * subscription-error path (D131); a binding that fails to load rejects
   * with {@link ChangeSourceLoadError}, and the service exits (D156).
   *
   * @param roots - Top roots (nested roots already collapsed).
   * @param _ignore - Unused: parcel takes the rewritten patterns (D156).
   * @param sink - Where batches and root state go.
   */
  async start(
    roots: readonly string[],
    _ignore: ((path: string) => boolean)[],
    sink: ChangeSink,
  ): Promise<void> {
    const context: SubscriptionContext = {
      parcel: this.options.parcel,
      backend: parcelBackend(this.platform),
      sink,
      logger: this.options.logger,
      lstat: this.lstat,
      serial: (work) => this.serial(work),
    };
    await this.serial(async () => {
      for (const root of roots) {
        const ignore = parcelIgnore(this.options.ignored, root, this.platform);
        const subscription = new RootSubscription(root, ignore, context);
        this.subscriptions.set(root, subscription);
        try {
          await subscription.subscribe();
        } catch (error) {
          if (isNativeLoadError(error)) throw new ChangeSourceLoadError(error);
          await subscription.failed(error);
        }
      }
    });
  }

  /**
   * Renew one root's subscription (Linux, D129): await the unsubscribe,
   * then subscribe. A rejected unsubscribe rebuilds every subscription
   * through a sentinel (D165, D176). Windows (and macOS) renew nothing
   * (D177).
   *
   * @param root - The root.
   * @returns Whether a rebuild ran, its duration and its extra failures.
   */
  renew(root: string): Promise<RenewResult> {
    if (this.platform !== 'linux') return Promise.resolve({ rebuilt: false });
    return this.serial(async () => {
      const subscription = this.subscriptions.get(root);
      if (!subscription?.subscribed) return { rebuilt: false };
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      if (!(await subscription.unsubscribe())) {
        const rebuildFailures = await this.rebuild(subscription);
        return { rebuilt: true, durationMs: elapsed(), rebuildFailures };
      }
      await this.resubscribe(subscription);
      return { rebuilt: false, durationMs: elapsed() };
    });
  }

  /** Unsubscribe every root and stop retrying. */
  async stop(): Promise<void> {
    await this.serial(async () => {
      for (const subscription of this.subscriptions.values()) {
        await subscription.stop();
      }
    });
    this.subscriptions.clear();
  }

  /**
   * Run `work` after every earlier queued operation, so subscribes,
   * unsubscribes and retries never interleave.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Subscribe again; a failure takes the subscription-error path (D131). */
  private async resubscribe(subscription: RootSubscription): Promise<void> {
    try {
      await subscription.subscribe();
    } catch (error) {
      await subscription.failed(error);
    }
  }

  /**
   * Rebuild after a rejected unsubscribe (D165): unsubscribe every other
   * root, subscribe and unsubscribe a sentinel so the backend's watcher
   * set empties and the backend restarts, then subscribe every root again.
   *
   * @param renewed - The root whose unsubscribe rejected.
   * @returns The rejections along the way (each logged).
   */
  private async rebuild(renewed: RootSubscription): Promise<number> {
    const { logger } = this.options;
    logger.error(
      { root: renewed.root },
      'Parcel unsubscribe rejected; rebuilding every subscription',
    );
    const others = [...this.subscriptions.values()].filter(
      (subscription) => subscription.subscribed,
    );
    let failures = 0;
    for (const subscription of others) {
      if (!(await subscription.unsubscribe())) failures += 1;
    }
    failures += await this.sentinel();
    for (const subscription of [renewed, ...others]) {
      await this.resubscribe(subscription);
    }
    return failures;
  }

  /**
   * Subscribe then unsubscribe `<stateDir>/parcel-sentinel` (D165).
   *
   * @returns 1 when either step rejected (logged), else 0.
   */
  private async sentinel(): Promise<number> {
    const dir = join(this.options.stateDir, SENTINEL_DIR);
    try {
      await mkdir(dir, { recursive: true });
      const handle = await this.options.parcel.subscribe(dir, () => undefined, {
        backend: parcelBackend(this.platform),
      });
      await handle.unsubscribe();
      return 0;
    } catch (error) {
      this.options.logger.error(
        { sentinel: dir, err: normalizeError(error) },
        'Parcel sentinel subscription failed during a rebuild',
      );
      return 1;
    }
  }
}
