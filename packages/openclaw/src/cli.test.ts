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
          entries: { 'jeeves-watcher-openclaw': { enabled: true } },
        },
      };
      const msgs = patchConfig(config, 'add');
      expect(msgs).toHaveLength(0);
    });

    it('does not set plugins.slots.memory on install', () => {
      const config: Record<string, unknown> = {};
      patchConfig(config, 'add');
      const plugins = config.plugins as Record<string, unknown>;
      expect(plugins.slots).toBeUndefined();
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

    it('reverts plugins.slots.memory on uninstall', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { 'jeeves-watcher-openclaw': { enabled: true } },
          slots: { memory: 'jeeves-watcher-openclaw' },
        },
      };
      const msgs = patchConfig(config, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      const slots = plugins.slots as Record<string, unknown>;
      expect(slots.memory).toBe('memory-core');
      expect(msgs.some((m) => m.includes('Reverted'))).toBe(true);
    });

    it('does not touch slot when owned by another plugin', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { 'jeeves-watcher-openclaw': { enabled: true } },
          slots: { memory: 'memory-core' },
        },
      };
      patchConfig(config, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      const slots = plugins.slots as Record<string, unknown>;
      expect(slots.memory).toBe('memory-core');
    });

    it('no-ops when plugin not present', () => {
      const config: Record<string, unknown> = {
        plugins: { entries: {} },
      };
      const msgs = patchConfig(config, 'remove');
      expect(msgs).toHaveLength(0);
    });
  });
});
