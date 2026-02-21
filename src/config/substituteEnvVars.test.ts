/**
 * @module config/substituteEnvVars.test
 *
 * Tests for environment variable substitution in config values.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { substituteEnvVars } from './substituteEnvVars';

describe('substituteEnvVars', () => {
  const ENV_KEY = 'JW_TEST_SUB_VAR';

  beforeEach(() => {
    process.env[ENV_KEY] = 'resolved-value';
  });

  afterEach(() => {
    process.env[ENV_KEY] = undefined;
  });

  it('replaces ${VAR} in a string', () => {
    expect(substituteEnvVars(`key=\${${ENV_KEY}}`)).toBe('key=resolved-value');
  });

  it('replaces env vars in nested objects', () => {
    const input = {
      a: { b: `\${${ENV_KEY}}` },
      c: [{ d: `prefix-\${${ENV_KEY}}` }],
    };
    const result = substituteEnvVars(input);
    expect(result.a.b).toBe('resolved-value');
    expect(result.c[0].d).toBe('prefix-resolved-value');
  });

  it('leaves non-string values untouched', () => {
    const input = { num: 42, bool: true, nil: null };
    expect(substituteEnvVars(input)).toEqual(input);
  });

  it('throws for missing env var', () => {
    expect(() => substituteEnvVars('${MISSING_JW_VAR_XYZ}')).toThrow(
      /MISSING_JW_VAR_XYZ.*not set/,
    );
  });
});
