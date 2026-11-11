/**
 * @module catalog/routes
 * Shared parts of the watcher catalog entries: the bearer auth every entry but `status` takes, and the `route`/`vcsRoute` helpers giving an entry its name, method, path, description and auth. No I/O.
 */

/** Bearer-key auth (`api.apiKey`) required by every entry except `status`. */
export const bearer = { schemes: [{ in: 'bearer' }] } as const;

/**
 * Name, method, path, description and auth of a bearer-protected entry.
 *
 * @param name - Entry name: verb-first (D77), the operation's one name.
 * @param method - HTTP method.
 * @param path - Route path.
 * @param description - What the operation does.
 */
export function route<
  const N extends string,
  const M extends 'DELETE' | 'GET' | 'POST',
  const P extends string,
>(name: N, method: M, path: P, description: string) {
  return { name, method, path, description, auth: bearer } as const;
}

/**
 * Description suffix of every entry the service serves only while version
 * control is on (spec Design 3): with VCS off, the route answers the
 * not-found 404 an unregistered route sends.
 */
export const VCS_DISABLED_NOTE =
  'Answers 404 `WATCHER_NOT_FOUND` when version control is disabled (`vcs.enabled: false`).';

/**
 * {@link route} for a version-control entry: its description ends with
 * {@link VCS_DISABLED_NOTE}.
 *
 * @param name - Entry name.
 * @param method - HTTP method.
 * @param path - Route path.
 * @param description - What the operation does.
 */
export function vcsRoute<
  const N extends string,
  const M extends 'DELETE' | 'GET' | 'POST',
  const P extends string,
>(name: N, method: M, path: P, description: string) {
  return route(name, method, path, `${description} ${VCS_DISABLED_NOTE}`);
}
