/**
 * @module expandEnv
 *
 * Recursive environment variable expansion for configuration values.
 */

const MAX_DEPTH = 10;

/**
 * Expand a single string value, resolving $\{VAR\} and $\{VAR:default\} syntax recursively.
 *
 * @param value - The string to expand.
 * @param env - Environment variable map.
 * @param depth - Current recursion depth (internal).
 * @returns The expanded string.
 */
export function expandEnv(
  value: string,
  env: Record<string, string | undefined>,
  depth = 0,
): string {
  if (depth > MAX_DEPTH) return value;

  const pattern = /\$\{([^}:]+)(?::([^}]*))?\}/g;

  const result = value.replace(
    pattern,
    (_match, varName: string, defaultValue?: string) => {
      const envValue = env[varName];
      if (envValue !== undefined) return envValue;
      return defaultValue ?? '';
    },
  );

  // Recurse if any replacements were made and result still contains $\{...\}
  if (result !== value && /\$\{[^}]+\}/.test(result)) {
    return expandEnv(result, env, depth + 1);
  }

  return result;
}

/**
 * Deep-walk an object/array/primitive and expand all string values.
 *
 * @param obj - The value to expand.
 * @param env - Environment variable map.
 * @returns The deeply expanded value.
 */
export function expandEnvDeep(
  obj: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof obj === 'string') {
    return expandEnv(obj, env);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvDeep(item, env));
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvDeep(value, env);
    }
    return result;
  }

  return obj;
}
