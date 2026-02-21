/**
 * @module config/substituteEnvVars
 *
 * Deep-walks config objects and replaces `${VAR_NAME}` patterns with environment variable values.
 */

const ENV_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Replace `${VAR_NAME}` patterns in a string with `process.env.VAR_NAME`.
 *
 * @param value - The string to process.
 * @returns The string with env vars substituted.
 * @throws If a referenced env var is not set.
 */
function substituteString(value: string): string {
  return value.replace(ENV_PATTERN, (match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable \${${varName}} referenced in config is not set.`,
      );
    }
    return envValue;
  });
}

/**
 * Deep-walk a value and substitute `${VAR_NAME}` patterns in all string values.
 *
 * @param value - The value to walk (object, array, or primitive).
 * @returns A new value with all env var references resolved.
 */
export function substituteEnvVars<T>(value: T): T {
  if (typeof value === 'string') {
    return substituteString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => substituteEnvVars(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = substituteEnvVars(val);
    }
    return result as T;
  }

  return value;
}
