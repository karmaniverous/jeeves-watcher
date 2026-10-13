/**
 * @module plugin/configTools.test
 * watcher_config and watcher_config_apply build the same requests as the core tools: GET /config (optional URL-encoded JSONPath) and POST /config/apply with the config wrapped as `patch`; a missing config is rejected before any request.
 */

import { describe, expect, it } from 'vitest';

import { configToolConfigs, CORE_TOOLS_REPLACED } from './configTools.js';

/** The buildRequest of a config tool by name. */
function build(name: string) {
  const tool = configToolConfigs.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.buildRequest;
}

describe('configToolConfigs', () => {
  it('replaces exactly the tools it defines', () => {
    expect(new Set(configToolConfigs.map((t) => t.name))).toEqual(
      CORE_TOOLS_REPLACED,
    );
  });

  it.each([
    [{}, ['/config']],
    [{ path: '$.api' }, ['/config?path=%24.api']],
    [{ path: '' }, ['/config']],
  ])('watcher_config %j requests %j', (params, request) => {
    expect(build('watcher_config')(params)).toEqual(request);
  });

  it('watcher_config_apply posts the config as patch', () => {
    expect(build('watcher_config_apply')({ config: { x: 1 } })).toEqual([
      '/config/apply',
      { patch: { x: 1 } },
    ]);
  });

  it('watcher_config_apply rejects a missing config', () => {
    expect(() => build('watcher_config_apply')({})).toThrow(
      'Missing required parameter: config',
    );
  });
});
