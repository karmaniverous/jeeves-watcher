/**
 * @module api/publicConfig
 * The config allow-list shared by GET /config and POST /config/apply responses: only these top-level keys are ever echoed, so secrets (`api`, `sources`, embedding/vector store keys) never leave the service. Pure.
 */

/**
 * Top-level config keys a response may expose. GET /config builds its merged
 * document from exactly these keys (plus `issues`); POST /config/apply
 * filters its echoed config through {@link publicConfig}.
 */
export const PUBLIC_CONFIG_KEYS = [
  'description',
  'watch',
  'configWatch',
  'search',
  'schemas',
  'inferenceRules',
  'mapHelpers',
  'templateHelpers',
  'maps',
  'templates',
] as const;

/**
 * Pick the allow-listed keys ({@link PUBLIC_CONFIG_KEYS}) from a config.
 *
 * @param config - A config object.
 * @returns A shallow copy holding only the allow-listed keys present.
 */
export function publicConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (key in config) result[key] = config[key];
  }
  return result;
}
