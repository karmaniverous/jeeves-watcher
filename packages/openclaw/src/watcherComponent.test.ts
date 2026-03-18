/**
 * @module plugin/watcherComponent.test
 * Unit tests for the watcher JeevesComponent implementation.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWatcherComponent } from './watcherComponent.js';

// Mock the promptInjection module so we don't make real HTTP calls.
vi.mock('./promptInjection.js', () => ({
  generateWatcherMenu: vi.fn().mockResolvedValue('Mocked watcher menu content'),
}));

describe('createWatcherComponent', () => {
  it('returns a valid JeevesComponent descriptor', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(component.name).toBe('watcher');
    expect(component.version).toBe('0.7.0');
    expect(component.sectionId).toBe('Watcher');
    expect(component.refreshIntervalSeconds).toBe(71);
  });

  it('generateToolsContent() returns placeholder before first async refresh', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    // First call triggers an async refresh; returns the placeholder synchronously.
    const content = component.generateToolsContent();
    expect(content).toContain('Initializing');
  });

  it('serviceCommands.status() returns { running: false } when API is unreachable', async () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:0',
      pluginVersion: '0.7.0',
    });

    const status = await component.serviceCommands.status();
    expect(status.running).toBe(false);
    expect(status.version).toBeUndefined();
  });
});
