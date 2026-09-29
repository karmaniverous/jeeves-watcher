import { jeevesComponentDescriptorSchema } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { createWatcherComponent } from './watcherComponent.js';

describe('createWatcherComponent', () => {
  const component = createWatcherComponent('1.2.3');

  it('conforms to the core descriptor schema', () => {
    expect(() =>
      jeevesComponentDescriptorSchema.parse(component),
    ).not.toThrow();
  });

  it('carries watcher identity and no v0.x content-writer fields', () => {
    expect(component.name).toBe('watcher');
    expect(component.version).toBe('1.2.3');
    expect(component.defaultPort).toBe(1936);
    expect(component).not.toHaveProperty('generateToolsContent');
    expect(component).not.toHaveProperty('sectionId');
    expect(component).not.toHaveProperty('refreshIntervalSeconds');
  });

  it('builds a start command and rejects run()', async () => {
    expect(component.startCommand('/c.json')).toEqual([
      'jeeves-watcher',
      'start',
      '-c',
      '/c.json',
    ]);
    expect(component.initTemplate()).toEqual({});
    await expect(component.run('/c.json')).rejects.toThrow('not available');
  });
});
