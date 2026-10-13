/**
 * @module config/assertResolvedSecrets
 * Fail-fast check that secret-bearing config values (api.apiKey, sources.*.url and headers) contain no unresolved `${VAR}` after env substitution, and that api.apiKey is not empty. Pure; throws.
 */

import type { JeevesWatcherConfig } from './types';

const UNRESOLVED_PATTERN = /\$\{[^}]*\}/;

/**
 * Collect config paths whose secret-bearing value still contains an
 * unresolved `${…}` reference. Values themselves are never returned.
 *
 * @param config - Config after environment-variable substitution.
 * @returns Dotted paths of offending values.
 */
export function findUnresolvedSecrets(config: JeevesWatcherConfig): string[] {
  const paths: string[] = [];
  const check = (path: string, value: string | undefined) => {
    if (value !== undefined && UNRESOLVED_PATTERN.test(value)) paths.push(path);
  };

  check('api.apiKey', config.api?.apiKey);

  for (const [name, source] of Object.entries(config.sources ?? {})) {
    check(`sources.${name}.url`, source.url);
    for (const [header, value] of Object.entries(source.headers ?? {})) {
      check(`sources.${name}.headers.${header}`, value);
    }
  }

  return paths;
}

/**
 * Throw when any secret-bearing value still contains an unresolved `${…}`,
 * or when `api.apiKey` is empty after substitution (e.g. its variable is set
 * to an empty string). Errors name config paths only, never values.
 *
 * @param config - Config after environment-variable substitution.
 * @throws Error listing the offending config paths.
 */
export function assertResolvedSecrets(config: JeevesWatcherConfig): void {
  const paths = findUnresolvedSecrets(config);
  if (paths.length > 0) {
    throw new Error(
      `Unresolved environment variable reference in: ${paths.join(', ')}. Set the referenced environment variables before starting jeeves-watcher.`,
    );
  }
  if (config.api?.apiKey === '') {
    throw new Error(
      'api.apiKey is empty after environment variable substitution. Set a non-empty key, or remove api.apiKey to disable authentication.',
    );
  }
}
