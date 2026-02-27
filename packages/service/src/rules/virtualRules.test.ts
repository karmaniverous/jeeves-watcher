import { describe, expect, it } from 'vitest';

import type { InferenceRule } from '../config/types';
import { VirtualRuleStore } from './virtualRules';

const makeRule = (name: string): InferenceRule => ({
  name,
  description: `Test rule ${name}`,
  match: {
    type: 'object',
    properties: {
      file: {
        type: 'object',
        properties: { path: { type: 'string', pattern: '.*\\.md$' } },
      },
    },
  },
  schema: [
    {
      type: 'object',
      properties: { domain: { type: 'string', set: 'test' } },
    },
  ],
});

describe('VirtualRuleStore', () => {
  it('starts empty', () => {
    const store = new VirtualRuleStore();
    expect(store.isEmpty).toBe(true);
    expect(store.size).toBe(0);
    expect(store.getCompiled()).toEqual([]);
    expect(store.getAll()).toEqual({});
  });

  it('registers and retrieves rules', () => {
    const store = new VirtualRuleStore();
    store.register('plugin-a', [makeRule('rule-1'), makeRule('rule-2')]);

    expect(store.isEmpty).toBe(false);
    expect(store.size).toBe(2);
    expect(store.getCompiled()).toHaveLength(2);

    const all = store.getAll();
    expect(all['plugin-a']).toHaveLength(2);
  });

  it('replaces rules on re-register with same source', () => {
    const store = new VirtualRuleStore();
    store.register('plugin-a', [makeRule('rule-1'), makeRule('rule-2')]);
    store.register('plugin-a', [makeRule('rule-3')]);

    expect(store.size).toBe(1);

    const all = store.getAll();
    expect(all['plugin-a'][0].name).toBe('rule-3');
  });

  it('supports multiple sources', () => {
    const store = new VirtualRuleStore();
    store.register('plugin-a', [makeRule('rule-a')]);
    store.register('plugin-b', [makeRule('rule-b')]);

    expect(store.size).toBe(2);
    expect(Object.keys(store.getAll())).toEqual(['plugin-a', 'plugin-b']);
  });

  it('unregisters by source', () => {
    const store = new VirtualRuleStore();
    store.register('plugin-a', [makeRule('rule-a')]);
    store.register('plugin-b', [makeRule('rule-b')]);

    const removed = store.unregister('plugin-a');
    expect(removed).toBe(true);
    expect(store.size).toBe(1);

    const all = store.getAll();
    expect(all['plugin-a']).toBeUndefined();
  });

  it('returns false when unregistering unknown source', () => {
    const store = new VirtualRuleStore();
    expect(store.unregister('nonexistent')).toBe(false);
  });

  it('compiled rules include validate functions', () => {
    const store = new VirtualRuleStore();
    store.register('plugin-a', [makeRule('rule-1')]);

    const compiled = store.getCompiled();
    expect(compiled[0]?.validate).toBeTypeOf('function');
    expect(compiled[0]?.rule.name).toBe('rule-1');
  });
});
