import { describe, expect, it } from 'vitest';

import { patchConfig } from './cli.js';

describe('patchConfig', () => {
  describe('add mode', () => {
    it('adds plugin to plugins.entries', () => {
      const config: Record<string, unknown> = {};
      const msgs = patchConfig(config, 'add');
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      expect(entries['jeeves-watcher-openclaw']).toEqual({ enabled: true });
      expect(msgs.some((m) => m.includes('plugins.entries'))).toBe(true);
    });

    it('adds to plugins.allow when populated', () => {
      const config: Record<string, unknown> = {
        plugins: { allow: ['other-plugin'], entries: {} },
      };
      patchConfig(config, 'add');
      const plugins = config.plugins as Record<string, unknown>;
      expect(plugins.allow).toContain('jeeves-watcher-openclaw');
    });

    it('skips plugins.allow when empty', () => {
      const config: Record<string, unknown> = {
        plugins: { allow: [], entries: {} },
      };
      const msgs = patchConfig(config, 'add');
      expect(msgs.every((m) => !m.includes('plugins.allow'))).toBe(true);
    });

    it('adds to tools.allow when populated', () => {
      const config: Record<string, unknown> = {
        tools: { allow: ['some-tool'] },
      };
      patchConfig(config, 'add');
      const tools = config.tools as Record<string, unknown>;
      expect(tools.allow).toContain('jeeves-watcher-openclaw');
    });

    it('does not duplicate if already present', () => {
      const config: Record<string, unknown> = {
        plugins: {
          allow: ['jeeves-watcher-openclaw'],
          entries: {
            'jeeves-watcher-openclaw': { enabled: true },
            'memory-core': { enabled: false },
          },
          slots: { memory: 'jeeves-watcher-openclaw' },
        },
      };
      const msgs = patchConfig(config, 'add', { memory: true });
      expect(msgs).toHaveLength(0);
    });

    it('claims memory slot when memory option is true', () => {
      const config: Record<string, unknown> = {};
      patchConfig(config, 'add', { memory: true });
      const plugins = config.plugins as Record<string, unknown>;
      const slots = plugins.slots as Record<string, unknown>;
      expect(slots.memory).toBe('jeeves-watcher-openclaw');
    });

    it('does not claim memory slot without memory option', () => {
      const config: Record<string, unknown> = {};
      patchConfig(config, 'add');
      const plugins = config.plugins as Record<string, unknown>;
      const slots = plugins.slots as Record<string, unknown>;
      expect(slots.memory).toBeUndefined();
    });

    it('reverts memory slot on non-memory install if previously claimed', () => {
      const config: Record<string, unknown> = {
        plugins: { slots: { memory: 'jeeves-watcher-openclaw' } },
      };
      const msgs = patchConfig(config, 'add', { memory: false });
      const plugins = config.plugins as Record<string, unknown>;
      const slots = plugins.slots as Record<string, unknown>;
      expect(slots.memory).toBe('memory-core');
      expect(msgs.some((m) => m.includes('Reverted'))).toBe(true);
    });

    it('disables memory-core when memory option is true', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { 'memory-core': { enabled: true } },
        },
      };
      patchConfig(config, 'add', { memory: true });
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      const memoryCore = entries['memory-core'] as Record<string, unknown>;
      expect(memoryCore.enabled).toBe(false);
    });

    it('creates memory-core entry as disabled when absent and memory option is true', () => {
      const config: Record<string, unknown> = {};
      patchConfig(config, 'add', { memory: true });
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      const memoryCore = entries['memory-core'] as Record<string, unknown>;
      expect(memoryCore.enabled).toBe(false);
    });

    it('re-enables memory-core on non-memory install', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { 'memory-core': { enabled: false } },
          slots: { memory: 'jeeves-watcher-openclaw' },
        },
      };
      patchConfig(config, 'add', { memory: false });
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      const memoryCore = entries['memory-core'] as Record<string, unknown>;
      expect(memoryCore.enabled).toBe(true);
    });

    it('does not duplicate when memory-core already disabled', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': { enabled: true },
            'memory-core': { enabled: false },
          },
          slots: { memory: 'jeeves-watcher-openclaw' },
        },
      };
      const msgs = patchConfig(config, 'add', { memory: true });
      expect(msgs).toHaveLength(0);
    });
  });

  describe('remove mode', () => {
    it('removes plugin from plugins.entries', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { 'jeeves-watcher-openclaw': { enabled: true } },
        },
      };
      const msgs = patchConfig(config, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      expect(entries).not.toHaveProperty('jeeves-watcher-openclaw');
      expect(msgs.some((m) => m.includes('Removed'))).toBe(true);
    });

    it('removes from plugins.allow', () => {
      const config: Record<string, unknown> = {
        plugins: {
          allow: ['other', 'jeeves-watcher-openclaw'],
          entries: {},
        },
      };
      patchConfig(config, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      expect(plugins.allow).toEqual(['other']);
    });

    it('removes from tools.allow', () => {
      const config: Record<string, unknown> = {
        tools: { allow: ['jeeves-watcher-openclaw'] },
      };
      patchConfig(config, 'remove');
      const tools = config.tools as Record<string, unknown>;
      expect(tools.allow).toEqual([]);
    });

    it('no-ops when plugin not present', () => {
      const config: Record<string, unknown> = {
        plugins: { entries: {} },
      };
      const msgs = patchConfig(config, 'remove');
      expect(msgs).toHaveLength(0);
    });

    it('re-enables memory-core on uninstall', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': { enabled: true },
            'memory-core': { enabled: false },
          },
          slots: { memory: 'jeeves-watcher-openclaw' },
        },
      };
      const msgs = patchConfig(config, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      const memoryCore = entries['memory-core'] as Record<string, unknown>;
      expect(memoryCore.enabled).toBe(true);
      expect(msgs.some((m) => m.includes('Re-enabled memory-core'))).toBe(
        true,
      );
    });
  });
});
