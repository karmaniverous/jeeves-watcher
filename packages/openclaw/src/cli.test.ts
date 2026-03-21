/**
 * @module cli.test
 */

import { patchConfig } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { PLUGIN_ID } from './constants.js';

describe('patchConfig', () => {
  describe('add mode', () => {
    it('adds plugin to plugins.entries', () => {
      const config: Record<string, unknown> = {};
      const msgs = patchConfig(config, PLUGIN_ID, 'add');
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      expect(entries[PLUGIN_ID]).toEqual({ enabled: true });
      expect(msgs.some((m: string) => m.includes('plugins.entries'))).toBe(
        true,
      );
    });

    it('adds to tools.alsoAllow when populated', () => {
      const config: Record<string, unknown> = {
        tools: { alsoAllow: ['some-tool'] },
      };
      patchConfig(config, PLUGIN_ID, 'add');
      const tools = config.tools as Record<string, unknown>;
      expect(tools.alsoAllow).toContain(PLUGIN_ID);
    });

    it('does not duplicate entries if already present', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: {
            [PLUGIN_ID]: { enabled: true },
          },
        },
        tools: { alsoAllow: [PLUGIN_ID] },
      };
      const msgs = patchConfig(config, PLUGIN_ID, 'add');
      expect(msgs).toHaveLength(0);
    });
  });

  describe('remove mode', () => {
    it('removes plugin from plugins.entries', () => {
      const config: Record<string, unknown> = {
        plugins: {
          entries: { [PLUGIN_ID]: { enabled: true } },
        },
      };
      const msgs = patchConfig(config, PLUGIN_ID, 'remove');
      const plugins = config.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, unknown>;
      expect(entries).not.toHaveProperty(PLUGIN_ID);
      expect(msgs.some((m: string) => m.includes('Removed'))).toBe(true);
    });

    it('removes from tools.alsoAllow', () => {
      const config: Record<string, unknown> = {
        tools: { alsoAllow: ['other', PLUGIN_ID] },
      };
      patchConfig(config, PLUGIN_ID, 'remove');
      const tools = config.tools as Record<string, unknown>;
      expect(tools.alsoAllow).toEqual(['other']);
    });

    it('no-ops when plugin not present', () => {
      const config: Record<string, unknown> = {
        plugins: { entries: {} },
      };
      const msgs = patchConfig(config, PLUGIN_ID, 'remove');
      expect(msgs).toHaveLength(0);
    });
  });
});
