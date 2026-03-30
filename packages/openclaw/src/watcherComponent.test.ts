/**
 * @module plugin/watcherComponent.test
 * Unit tests for the watcher JeevesComponentDescriptor.
 */

import { jeevesComponentDescriptorSchema } from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

import { createWatcherComponent } from './watcherComponent.js';

// Mock the promptInjection module so we don't make real HTTP calls.
vi.mock('./promptInjection.js', () => ({
  generateWatcherMenu: vi.fn().mockResolvedValue('Mocked watcher menu content'),
}));

describe('createWatcherComponent', () => {
  it('validates against the component descriptor schema', () => {
    const descriptor = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(() =>
      jeevesComponentDescriptorSchema.parse(descriptor),
    ).not.toThrow();
  });

  it('has correct identity fields', () => {
    const descriptor = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(descriptor.name).toBe('watcher');
    expect(descriptor.version).toBe('0.7.0');
    expect(descriptor.sectionId).toBe('Watcher');
    expect(descriptor.refreshIntervalSeconds).toBe(71);
    expect(descriptor.defaultPort).toBe(1936);
    expect(descriptor.configFileName).toBe('config.json');
    expect(descriptor.servicePackage).toBe('@karmaniverous/jeeves-watcher');
    expect(descriptor.pluginPackage).toBe(
      '@karmaniverous/jeeves-watcher-openclaw',
    );
  });

  it('generateToolsContent() returns placeholder before first async refresh', () => {
    const descriptor = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    // First call triggers an async refresh; returns the placeholder synchronously.
    const content = descriptor.generateToolsContent();
    expect(content).toContain('Initializing');
  });
});
