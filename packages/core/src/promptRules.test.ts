import { describe, expect, it } from 'vitest';

import { WATCHER_PROMPT_RULES } from './promptRules';

describe('WATCHER_PROMPT_RULES', () => {
  it('carries the search-first, scan-first, and escalation rules', () => {
    expect(WATCHER_PROMPT_RULES).toContain('Escalation rule');
    expect(WATCHER_PROMPT_RULES).toContain('Scan-first rule');
    expect(WATCHER_PROMPT_RULES).toContain('Search-first rule');
    expect(WATCHER_PROMPT_RULES).toContain('$.search.scoreThresholds');
  });

  it('states that score thresholds have no defaults', () => {
    expect(WATCHER_PROMPT_RULES).toContain('there are no defaults');
    expect(WATCHER_PROMPT_RULES).not.toMatch(/\d\.\d+ \/ \d\.\d+/);
  });
});
