import { describe, expect, it } from 'vitest';

import {
  connectionFail,
  fail,
  getApiUrl,
  getWorkspacePath,
  normalizePath,
  ok,
  type PluginApi,
} from './helpers.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\test\\file.md')).toBe(
      'c:/Users/test/file.md',
    );
  });

  it('lowercases Windows drive letter', () => {
    expect(normalizePath('D:/projects')).toBe('d:/projects');
  });

  it('leaves Unix paths unchanged', () => {
    expect(normalizePath('/home/user/file.md')).toBe('/home/user/file.md');
  });

  it('handles already-normalized paths', () => {
    expect(normalizePath('c:/already/normal')).toBe('c:/already/normal');
  });
});

describe('getWorkspacePath', () => {
  it('uses agent-specific workspace', () => {
    const api: PluginApi = {
      config: {
        agents: {
          entries: { main: { workspace: '/custom/workspace' } },
        },
      },
      registerTool: () => {},
    };
    expect(getWorkspacePath(api)).toBe('/custom/workspace');
  });

  it('falls back to defaults workspace', () => {
    const api: PluginApi = {
      config: {
        agents: { defaults: { workspace: '/default/ws' } },
      },
      registerTool: () => {},
    };
    expect(getWorkspacePath(api)).toBe('/default/ws');
  });

  it('falls back to homedir when no config', () => {
    const api: PluginApi = { registerTool: () => {} };
    const result = getWorkspacePath(api);
    expect(result).toContain('.openclaw');
    expect(result).toContain('workspace');
  });
});

describe('getApiUrl', () => {
  it('returns configured URL', () => {
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher': {
              config: { apiUrl: 'http://localhost:9999' },
            },
          },
        },
      },
      registerTool: () => {},
    };
    expect(getApiUrl(api)).toBe('http://localhost:9999');
  });

  it('returns default when no config', () => {
    const api: PluginApi = { registerTool: () => {} };
    expect(getApiUrl(api)).toBe('http://127.0.0.1:3458');
  });
});

describe('ok', () => {
  it('wraps data in content array', () => {
    const result = ok({ key: 'value' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ key: 'value' });
  });
});

describe('fail', () => {
  it('wraps error message', () => {
    const result = fail(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: boom');
  });

  it('handles non-Error values', () => {
    const result = fail('string error');
    expect(result.content[0].text).toBe('Error: string error');
  });
});

describe('connectionFail', () => {
  it('returns connection guidance for ECONNREFUSED', () => {
    const error = new Error('fetch failed');
    (error as Error & { cause: unknown }).cause = { code: 'ECONNREFUSED' };
    const result = connectionFail(error, 'http://localhost:3458');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not reachable');
  });

  it('returns generic error for non-connection errors', () => {
    const result = connectionFail(new Error('bad request'), 'http://x');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: bad request');
  });
});
