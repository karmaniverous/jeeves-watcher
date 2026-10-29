import type { PluginApi } from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

import { registerWatcherPromptContext } from './promptContext.js';

const component = { promptRules: '## Rules' };

describe('registerWatcherPromptContext', () => {
  it('returns false when the host has no api.on', () => {
    const api: PluginApi = { registerTool: vi.fn(), logger: { warn: vi.fn() } };
    expect(registerWatcherPromptContext(api, component)).toBe(false);
  });

  it('returns false and registers nothing when the descriptor has no rules', () => {
    const on = vi.fn();
    const api = { registerTool: vi.fn(), on } as unknown as PluginApi;
    expect(registerWatcherPromptContext(api, {})).toBe(false);
    expect(on).not.toHaveBeenCalled();
  });

  it('registers the descriptor rules on before_prompt_build', () => {
    const on = vi.fn();
    const api = { registerTool: vi.fn(), on } as unknown as PluginApi;
    expect(registerWatcherPromptContext(api, component)).toBe(true);
    expect(on).toHaveBeenCalledWith(
      'before_prompt_build',
      expect.any(Function),
      expect.anything(),
    );
    const handler = on.mock.calls[0][1] as () => unknown;
    expect(handler()).toEqual({ appendSystemContext: '## Rules' });
  });
});
