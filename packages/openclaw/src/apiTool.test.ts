import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiToolConfig,
  buildQuery,
  type CatalogToolDescriptor,
  pickDefined,
  registerApiTool,
} from './apiTool.js';

const config: ApiToolConfig = {
  name: 'watcher_example',
  description: 'Example tool.',
  parameters: { type: 'object', properties: {} },
  buildRequest: () => ['/example'],
};

/** Register one config and return the descriptor handed to the API. */
function registerOne(cfg: ApiToolConfig): CatalogToolDescriptor {
  const registered: ToolDescriptor[] = [];
  const api: PluginApi = {
    registerTool: (tool: ToolDescriptor) => {
      registered.push(tool);
    },
  };
  registerApiTool(api, 'http://localhost:1936', cfg);
  expect(registered).toHaveLength(1);
  return registered[0];
}

describe('registerApiTool', () => {
  it('passes catalogMode through when configured', () => {
    const tool = registerOne({ ...config, catalogMode: 'direct-only' });
    expect(tool.catalogMode).toBe('direct-only');
  });

  it('omits catalogMode entirely when not configured', () => {
    expect(registerOne(config)).not.toHaveProperty('catalogMode');
  });
});

describe('registerApiTool base URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a function base URL on every call', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const registered: ToolDescriptor[] = [];
    const api: PluginApi = {
      registerTool: (tool: ToolDescriptor) => {
        registered.push(tool);
      },
    };
    let base = 'http://first:1';
    registerApiTool(api, () => base, config);

    await registered[0].execute('1', {});
    base = 'http://second:2';
    await registered[0].execute('2', {});

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual(['http://first:1/example', 'http://second:2/example']);
  });
});

describe('buildQuery', () => {
  it('encodes defined values and JSON-stringifies non-strings', () => {
    expect(buildQuery({ a: 'x y', b: 2, c: undefined }, ['a', 'b', 'c'])).toBe(
      '?a=x%20y&b=2',
    );
  });

  it('returns an empty string when no keys are defined', () => {
    expect(buildQuery({}, ['a'])).toBe('');
  });
});

describe('pickDefined', () => {
  it('keeps only listed, defined keys', () => {
    expect(pickDefined({ a: 1, b: undefined, c: 3 }, ['a', 'b'])).toEqual({
      a: 1,
    });
  });
});
