import { describe, expect, it } from 'vitest';

import { expandEnv, expandEnvDeep } from './expandEnv';

describe('expandEnv', () => {
  it('should perform simple substitution', () => {
    const env = { FOO: 'bar' };
    expect(expandEnv('${FOO}', env)).toBe('bar');
    expect(expandEnv('prefix-${FOO}-suffix', env)).toBe('prefix-bar-suffix');
  });

  it('should use default value when variable is missing', () => {
    const env = {};
    expect(expandEnv('${MISSING:fallback}', env)).toBe('fallback');
    expect(expandEnv('prefix-${MISSING:default}-suffix', env)).toBe(
      'prefix-default-suffix',
    );
  });

  it('should return empty string when variable is missing and no default', () => {
    const env = {};
    expect(expandEnv('${MISSING}', env)).toBe('');
    expect(expandEnv('prefix-${MISSING}-suffix', env)).toBe('prefix--suffix');
  });

  it('should expand recursively', () => {
    const env = { A: 'hello-${B}', B: 'world' };
    expect(expandEnv('${A}', env)).toBe('hello-world');
  });

  it('should pass through strings without substitutions', () => {
    const env = { FOO: 'bar' };
    expect(expandEnv('plain text', env)).toBe('plain text');
    expect(expandEnv('no variables here', env)).toBe('no variables here');
  });

  it('should handle multiple substitutions', () => {
    const env = { A: 'alpha', B: 'beta' };
    expect(expandEnv('${A}-${B}', env)).toBe('alpha-beta');
  });

  it('should guard against infinite recursion', () => {
    const env = { A: '${B}', B: '${A}' };
    const result = expandEnv('${A}', env);
    expect(result).toBeTruthy(); // Should not hang
  });
});

describe('expandEnvDeep', () => {
  it('should expand strings in objects', () => {
    const env = { FOO: 'bar' };
    const input = { key: '${FOO}', nested: { inner: '${FOO}' } };
    const result = expandEnvDeep(input, env);
    expect(result).toEqual({ key: 'bar', nested: { inner: 'bar' } });
  });

  it('should expand strings in arrays', () => {
    const env = { FOO: 'bar' };
    const input = ['${FOO}', 'plain', '${FOO}'];
    const result = expandEnvDeep(input, env);
    expect(result).toEqual(['bar', 'plain', 'bar']);
  });

  it('should handle nested arrays and objects', () => {
    const env = { FOO: 'bar' };
    const input = {
      items: ['${FOO}', { name: '${FOO}' }],
    };
    const result = expandEnvDeep(input, env);
    expect(result).toEqual({
      items: ['bar', { name: 'bar' }],
    });
  });

  it('should pass through non-string primitives', () => {
    const env = { FOO: 'bar' };
    const input = {
      num: 42,
      bool: true,
      nul: null,
      str: '${FOO}',
    };
    const result = expandEnvDeep(input, env);
    expect(result).toEqual({
      num: 42,
      bool: true,
      nul: null,
      str: 'bar',
    });
  });

  it('should expand primitive strings', () => {
    const env = { FOO: 'bar' };
    expect(expandEnvDeep('${FOO}', env)).toBe('bar');
  });
});
