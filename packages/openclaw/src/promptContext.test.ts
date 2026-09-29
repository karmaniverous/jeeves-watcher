import type { PluginApi } from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

import {
  registerWatcherPromptContext,
  WATCHER_PROMPT_CONTEXT,
} from './promptContext.js';

describe('WATCHER_PROMPT_CONTEXT', () => {
  it('carries the search-first, scan-first, and escalation rules', () => {
    expect(WATCHER_PROMPT_CONTEXT).toContain('Escalation rule');
    expect(WATCHER_PROMPT_CONTEXT).toContain('Scan-first rule');
    expect(WATCHER_PROMPT_CONTEXT).toContain('Search-first rule');
    expect(WATCHER_PROMPT_CONTEXT).toContain('$.search.scoreThresholds');
  });
});

describe('registerWatcherPromptContext', () => {
  it('returns false when the host has no api.on', () => {
    const api: PluginApi = { registerTool: vi.fn(), logger: { warn: vi.fn() } };
    expect(registerWatcherPromptContext(api)).toBe(false);
  });

  it('registers before_prompt_build when supported', () => {
    const on = vi.fn();
    const api = { registerTool: vi.fn(), on } as unknown as PluginApi;
    expect(registerWatcherPromptContext(api)).toBe(true);
    expect(on).toHaveBeenCalledWith(
      'before_prompt_build',
      expect.any(Function),
      expect.anything(),
    );
  });
});
