/**
 * @module api/featureGates
 * Feature gating of catalog entries (spec Design 3, D28, D50). Every catalog route is always registered; an entry whose feature is off answers the exact not-found 404 an unregistered route sends, whatever the request. `WATCHER_FEATURE_GATES` maps each gated entry to its feature; the gate is computed once at registration, so turning a feature on or off needs a restart. Pure.
 */

import type { WatcherEntryName } from './catalog/catalogEntry';

/** A feature that can be off in a running service. */
export type WatcherFeature = 'vcs';

/** Which features are on in a running service. */
export type WatcherFeatures = Readonly<Record<WatcherFeature, boolean>>;

/**
 * The gated catalog entries and the feature each needs: every `/vcs/*`
 * entry needs version control (`vcs.enabled`, a `VcsCoordinator`).
 */
export const WATCHER_FEATURE_GATES = {
  getVcsStatus: 'vcs',
  listVcsHistory: 'vcs',
  showVcsFile: 'vcs',
  diffVcs: 'vcs',
  checkVcsExclusion: 'vcs',
  revertVcs: 'vcs',
  excludeVcsPath: 'vcs',
} as const satisfies Partial<Record<WatcherEntryName, WatcherFeature>>;

/** The name of a gated catalog entry. */
export type GatedEntryName = keyof typeof WATCHER_FEATURE_GATES;

/** The route of a catalog entry, as far as gating looks. */
interface GatedRoute {
  /** Entry name. */
  name: string;
  /** HTTP method. */
  method: string;
  /** Fastify route path. */
  path: string;
}

/**
 * The route key of a request: method and Fastify route path. `HEAD` is
 * keyed as `GET`, since Fastify derives a `HEAD` route from every `GET`
 * route. Pure.
 *
 * @param method - Request method.
 * @param path - Matched route path (not the URL).
 * @returns The key.
 */
export function routeKey(method: string, path: string): string {
  return `${method === 'HEAD' ? 'GET' : method} ${path}`;
}

/**
 * The route keys ({@link routeKey}) of every gated entry whose feature is
 * off. Pure.
 *
 * @param entries - Catalog entries (name, method, path).
 * @param features - Which features are on.
 * @returns The keys of the routes that must answer as if unregistered.
 */
export function disabledRoutes(
  entries: readonly GatedRoute[],
  features: WatcherFeatures,
): ReadonlySet<string> {
  const gates: Partial<Record<string, WatcherFeature>> = WATCHER_FEATURE_GATES;
  return new Set(
    entries
      .filter((entry) => {
        const feature = gates[entry.name];
        return feature !== undefined && !features[feature];
      })
      .map((entry) => routeKey(entry.method, entry.path)),
  );
}
