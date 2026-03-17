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
  it('returns a component with required JeevesComponent fields', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(component.name).toBe('watcher');
    expect(component.version).toBe('0.7.0');
    expect(component.sectionId).toBe('Watcher');
    expect(component.refreshIntervalSeconds).toBe(71);
  });

  it('generateToolsContent() is callable and returns a string', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    const content = component.generateToolsContent();
    expect(typeof content).toBe('string');
  });

  it('serviceCommands.stop is a callable function', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(typeof component.serviceCommands.stop).toBe('function');
  });

  it('serviceCommands.uninstall is a callable function', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(typeof component.serviceCommands.uninstall).toBe('function');
  });

  it('serviceCommands.status is a callable function', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(typeof component.serviceCommands.status).toBe('function');
  });

  it('pluginCommands.uninstall is a callable function', () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:1936',
      pluginVersion: '0.7.0',
    });

    expect(typeof component.pluginCommands.uninstall).toBe('function');
  });

  it('serviceCommands.status returns ServiceStatus when API unreachable', async () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:0',
      pluginVersion: '0.7.0',
    });

    const status = await component.serviceCommands.status();
    expect(status).toHaveProperty('running');
    expect(status.running).toBe(false);
  });
});
