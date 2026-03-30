import { jeevesComponentDescriptorSchema } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { watcherDescriptor } from './descriptor';

describe('watcherDescriptor', () => {
  it('validates against the component descriptor schema', () => {
    expect(() =>
      jeevesComponentDescriptorSchema.parse(watcherDescriptor),
    ).not.toThrow();
  });

  it('has correct identity and config fields', () => {
    expect(watcherDescriptor.name).toBe('watcher');
    expect(watcherDescriptor.defaultPort).toBe(1936);
    expect(watcherDescriptor.configFileName).toBe('config.json');
    expect(watcherDescriptor.sectionId).toBe('Watcher');
    expect(watcherDescriptor.refreshIntervalSeconds).toBe(71);
    expect(watcherDescriptor.servicePackage).toBe(
      '@karmaniverous/jeeves-watcher',
    );
    expect(watcherDescriptor.pluginPackage).toBe(
      '@karmaniverous/jeeves-watcher-openclaw',
    );
  });

  it('returns an empty plugin tool list in Phase 2', () => {
    expect(watcherDescriptor.customPluginTools?.({} as never)).toEqual([]);
  });
});
