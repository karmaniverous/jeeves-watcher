/**
 * @module watcher/changeSource/parcelSubscription
 * One root's parcel subscription (D126, D131, D156, D179): subscribe with the explicit backend and the root's ignore list, keep the returned handle (the only way it is unsubscribed), a callback that never throws, and recovery from subscription errors: resubscribe with backoff, root gone and back, or unwatched after a non-transient `inotify_add_watch` failure. I/O: parcel subscriptions, `lstat` of the root, one backoff timer.
 */

import type pino from 'pino';

import { keyWithin, normalizeDocumentKey } from '../../util/documentKey';
import { normalizeError } from '../../util/normalizeError';
import type {
  ParcelBackend,
  ParcelSubscription,
  ParcelWatcherModule,
} from './parcelModule';
import type { ChangeSink, RawChangeEvent } from './types';

/** First resubscribe delay (D131). */
export const BACKOFF_INITIAL_MS = 1000;

/** Longest resubscribe delay (D131). */
export const BACKOFF_MAX_MS = 300_000;

/** What every root subscription of one source shares. */
export interface SubscriptionContext {
  parcel: ParcelWatcherModule;
  backend: ParcelBackend;
  sink: ChangeSink;
  logger: pino.Logger;
  /** Resolves when the path exists; rejects with its error otherwise. */
  lstat: (path: string) => Promise<unknown>;
  /** Run work after every earlier source operation (renewals, retries). */
  serial: <T>(work: () => Promise<T>) => Promise<T>;
}

/** Where a root subscription stands. */
type Mode = 'subscribed' | 'retrying' | 'unwatched' | 'stopped';

/** An error's code (`ENOENT`, ...) or name. */
function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Whether a parcel error is a failed `inotify_add_watch` (D156). */
function isWatchLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('inotify_add_watch');
}

/**
 * One top root's subscription. Every method that touches parcel runs inside
 * the source's serial queue; the callback and the backoff timer enter it.
 */
export class RootSubscription {
  private handle: ParcelSubscription | undefined;
  private mode: Mode = 'retrying';
  /** The sink was told the root is unavailable. */
  private signalled: 'gone' | 'unwatched' | undefined;
  private delay = BACKOFF_INITIAL_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly rootKey: string;

  /**
   * @param root - The root (a top root; nested roots are collapsed).
   * @param ignore - Its parcel ignore list, fixed for the source (D179).
   * @param context - Shared parcel, sink and serial queue.
   */
  constructor(
    readonly root: string,
    private readonly ignore: string[],
    private readonly context: SubscriptionContext,
  ) {
    this.rootKey = normalizeDocumentKey(root);
  }

  /** Whether parcel currently holds a subscription for the root. */
  get subscribed(): boolean {
    return this.mode === 'subscribed';
  }

  /**
   * Subscribe (no queue: the caller holds it). Rejects with parcel's error.
   */
  async subscribe(): Promise<void> {
    const { parcel, backend } = this.context;
    this.handle = await parcel.subscribe(
      this.root,
      (err, events) => {
        this.callback(err, events);
      },
      { backend, ignore: this.ignore },
    );
    this.mode = 'subscribed';
  }

  /**
   * Unsubscribe through the handle (D179) and report a rejection, which
   * a renewal turns into a rebuild (D165). The handle is dropped either
   * way. Caller holds the queue.
   *
   * @returns False when parcel rejected the unsubscribe.
   */
  async unsubscribe(): Promise<boolean> {
    const handle = this.handle;
    this.handle = undefined;
    if (this.mode === 'subscribed') this.mode = 'retrying';
    if (!handle) return true;
    try {
      await handle.unsubscribe();
      return true;
    } catch (error) {
      this.context.logger.error(
        { root: this.root, err: normalizeError(error) },
        'Parcel unsubscribe rejected',
      );
      return false;
    }
  }

  /**
   * A subscription error, or a failed subscribe (D131): `lstat` the root.
   * Gone: unavailable, and retry (D109). Present with a failed
   * `inotify_add_watch`: unwatched, no retry (D156). Present otherwise:
   * resubscribe with backoff. Caller holds the queue.
   *
   * @param error - Parcel's error.
   */
  async failed(error: unknown): Promise<void> {
    if (this.mode === 'stopped') return;
    const { logger, sink } = this.context;
    await this.unsubscribe();
    const gone = await this.context.lstat(this.root).then(
      () => undefined,
      (lstatError: unknown) => codeOf(lstatError),
    );
    if (gone !== undefined) {
      logger.warn({ root: this.root, code: gone }, 'Watch root gone');
      if (this.signalled !== 'gone') sink.rootUnavailable(this.root, gone);
      this.signalled = 'gone';
      this.retry();
      return;
    }
    if (isWatchLimitError(error)) {
      logger.error(
        { root: this.root, err: normalizeError(error) },
        'Parcel could not add an inotify watch; the root stays unwatched (still reconciled) until a reload or restart. Raise fs.inotify.max_user_watches.',
      );
      this.mode = 'unwatched';
      this.signalled = 'unwatched';
      sink.rootUnavailable(this.root, codeOf(error), { reachable: true });
      return;
    }
    logger.warn(
      { root: this.root, err: normalizeError(error), retryInMs: this.delay },
      'Parcel subscription error; resubscribing',
    );
    this.retry();
  }

  /** Stop: no more retries, unsubscribe. Caller holds the queue. */
  async stop(): Promise<void> {
    this.mode = 'stopped';
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.unsubscribe();
  }

  /** Schedule the next attempt with backoff (1 s doubling to 5 min). */
  private retry(): void {
    if (this.mode === 'stopped') return;
    this.mode = 'retrying';
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, BACKOFF_MAX_MS);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.context.serial(() => this.attempt());
    }, delay);
    this.timer.unref();
  }

  /** One retry: subscribe again and tell the sink how the root is back. */
  private async attempt(): Promise<void> {
    if (this.mode !== 'retrying') return;
    try {
      await this.context.lstat(this.root);
      await this.subscribe();
    } catch (error) {
      await this.failed(error);
      return;
    }
    this.delay = BACKOFF_INITIAL_MS;
    const wasGone = this.signalled === 'gone';
    this.signalled = undefined;
    this.context.logger.info(
      { root: this.root },
      'Parcel subscription restored',
    );
    if (wasGone) this.context.sink.rootAvailable(this.root);
    else this.context.sink.resubscribed(this.root);
  }

  /**
   * Parcel's callback. It never throws into parcel (D179): any error is
   * logged with the root and batch size, and the batch is dropped (the
   * periodic reconcile recovers it).
   */
  private callback(err: Error | null, events: RawChangeEvent[]): void {
    try {
      if (this.mode === 'stopped') return;
      if (err) {
        this.queueFailure(err);
        return;
      }
      const rootDeleted = events.some(
        (event) =>
          event.type === 'delete' &&
          keyWithin(this.rootKey, normalizeDocumentKey(event.path)),
      );
      if (rootDeleted) {
        this.queueRootCheck(events);
        return;
      }
      this.context.sink.rawEvents(this.root, events);
    } catch (error) {
      this.context.logger.error(
        { root: this.root, events: events.length, err: normalizeError(error) },
        'Change batch handling failed; batch dropped',
      );
    }
  }

  /** A subscription error from the callback, handled in the queue. */
  private queueFailure(error: Error): void {
    void this.context
      .serial(() => this.failed(error))
      .catch((failure: unknown) => {
        this.logFailure(failure);
      });
  }

  /**
   * A `delete` naming the root (or an ancestor): `lstat` decides whether
   * the root is gone (D109, D156); if it is still there, the batch goes on.
   */
  private queueRootCheck(events: RawChangeEvent[]): void {
    const check = async () => {
      if (this.mode !== 'subscribed') return;
      const present = await this.context.lstat(this.root).then(
        () => true,
        () => false,
      );
      if (present) this.context.sink.rawEvents(this.root, events);
      else await this.failed(new Error('watch root deleted'));
    };
    void this.context.serial(check).catch((failure: unknown) => {
      this.logFailure(failure);
    });
  }

  private logFailure(failure: unknown): void {
    this.context.logger.error(
      { root: this.root, err: normalizeError(failure) },
      'Parcel subscription recovery failed',
    );
  }
}
