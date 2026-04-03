/**
 * @module plugin/configApplyIntegration.test
 * Cross-cutting integration test: exercises the factory-generated
 * watcher_config_apply tool against a mock /config/apply handler to verify
 * the `patch` envelope round-trip works end-to-end.
 */

import type { PluginApi, ToolResult } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import register from './index.js';

type ExecuteFn = (
  id: string,
  params: Record<string, unknown>,
) => Promise<ToolResult>;

/** Register all tools via the full plugin entry point and capture executors. */
function captureAllTools() {
  const executors = new Map<string, ExecuteFn>();
  const api: PluginApi = {
    config: {
      plugins: {
        entries: {
          'jeeves-watcher-openclaw': {
            config: {
              apiUrl: 'http://localhost:1936',
              configRoot: 'j:/config',
            },
          },
        },
      },
    },
    registerTool: (tool: { name: string; execute: ExecuteFn }) => {
      executors.set(tool.name, tool.execute);
    },
  };
  register(api);
  return executors;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watcher_config_apply { patch } envelope round-trip', () => {
  it('sends config inside a { patch } envelope to /config/apply', async () => {
    const responsePayload = { applied: true, merged: { x: 1, y: 2 } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responsePayload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tools = captureAllTools();
    const configApply = tools.get('watcher_config_apply');
    expect(configApply).toBeDefined();

    const result = await configApply!('call-1', { config: { x: 1 } });

    // Verify the tool called /config/apply with { patch } envelope.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/config/apply');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ patch: { x: 1 } });

    // Verify successful response round-trip.
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual(responsePayload);
  });

  it('returns an error result when the service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        Object.assign(new Error('connect failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      ),
    );

    const tools = captureAllTools();
    const result = await tools.get('watcher_config_apply')!('call-2', {
      config: { x: 1 },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not reachable');
  });
});
