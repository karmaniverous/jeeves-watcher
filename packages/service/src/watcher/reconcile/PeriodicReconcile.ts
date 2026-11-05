/**
 * @module watcher/reconcile/PeriodicReconcile
 * Periodic reconciliation (D111): one timer per root, the first run staggered to `i * interval / n` (i from 1) after the root's initial scan, then every interval; each run renews the root's subscription first (D129, a no-op under chokidar). The interval is read through a getter at each scheduling; 0 disables it. I/O: timers only (the callbacks do the work).
 */

/** What {@link renewThenReconcile} uses. */
export interface RenewThenReconcileDeps {
  /** The change source's renewal (D129). */
  renew: (root: string) => Promise<{ rebuilt: boolean }>;
  /** Reconcile one directory. */
  reconcile: (dir: string) => Promise<void>;
  /** Every root. */
  roots: string[];
  /** Count a renewal that rebuilt the source (D165). */
  onRebuilt: () => void;
}

/**
 * One periodic run for `root`: renew its subscription first (a no-op under
 * chokidar), then reconcile it. A renewal that rebuilt the source lost
 * every root's events in between (D165), so every root is reconciled.
 *
 * @param deps - Renewal, reconcile, roots and the rebuilt counter.
 * @param root - The root due.
 */
export async function renewThenReconcile(
  deps: RenewThenReconcileDeps,
  root: string,
): Promise<void> {
  const { rebuilt } = await deps.renew(root);
  if (!rebuilt) {
    await deps.reconcile(root);
    return;
  }
  deps.onRebuilt();
  await Promise.all(deps.roots.map((r) => deps.reconcile(r)));
}

/** What {@link PeriodicReconcile} drives. */
export interface PeriodicReconcileDeps {
  /** The roots, in a fixed order (their index sets the stagger). */
  roots: string[];
  /** `watch.reconcileIntervalMs`, read at each scheduling. */
  intervalMs: () => number;
  /** Renew then reconcile one root (a rejection is reported, then the next run is scheduled). */
  run: (root: string) => Promise<void>;
  /** Report a run that rejected. */
  onRunError: (root: string, error: unknown) => void;
}

/** Per-root periodic reconcile timers. */
export class PeriodicReconcile {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly armed = new Set<string>();
  private stopped = false;
  /** The interval each armed root was last scheduled with. */
  private readonly intervals = new Map<string, number>();

  /** @param deps - Roots, interval getter and the run callback. */
  constructor(private readonly deps: PeriodicReconcileDeps) {}

  /**
   * A root's initial scan finished: schedule its first run at
   * `i * interval / n`, i being the root's 1-based index.
   *
   * @param root - The root (one of `deps.roots`).
   */
  arm(root: string): void {
    if (this.stopped) return;
    this.armed.add(root);
    this.schedule(root, true);
  }

  /**
   * A reload: re-schedule (staggered again) each armed root whose last
   * scheduling used another interval. A root already on the current
   * interval keeps its timer, so frequent reloads never postpone a run,
   * and a root that happened to be rescheduled between the config change
   * and this call does not hide the others.
   */
  refresh(): void {
    const interval = this.deps.intervalMs();
    for (const root of this.armed) {
      if (this.intervals.get(root) !== interval) this.schedule(root, true);
    }
  }

  /** Clear every timer; nothing runs after this. */
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(root: string, first: boolean): void {
    const existing = this.timers.get(root);
    if (existing) clearTimeout(existing);
    this.timers.delete(root);
    const interval = this.deps.intervalMs();
    this.intervals.set(root, interval);
    if (this.stopped || interval <= 0) return;
    // 1-based stagger: no root reconciles right after its own initial scan.
    const i = Math.max(0, this.deps.roots.indexOf(root)) + 1;
    const delay = first ? (i * interval) / this.deps.roots.length : interval;
    const timer = setTimeout(() => {
      this.timers.delete(root);
      void this.deps
        .run(root)
        .catch((error: unknown) => {
          this.deps.onRunError(root, error);
        })
        .finally(() => {
          if (!this.stopped && !this.timers.has(root)) {
            this.schedule(root, false);
          }
        });
    }, delay);
    timer.unref();
    this.timers.set(root, timer);
  }
}
