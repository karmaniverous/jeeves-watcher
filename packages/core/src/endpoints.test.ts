import { describe, expect, it } from 'vitest';

import { type EndpointName, getEndpoint, WATCHER_ENDPOINTS } from './endpoints';

describe('endpoint catalog', () => {
  it('contains at least one endpoint', () => {
    expect(WATCHER_ENDPOINTS.length).toBeGreaterThan(0);
  });

  it('has unique names', () => {
    const names = WATCHER_ENDPOINTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique path+method combinations', () => {
    const keys = WATCHER_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('getEndpoint returns correct descriptor for each name', () => {
    for (const ep of WATCHER_ENDPOINTS) {
      const result = getEndpoint(ep.name);
      expect(result).toBe(ep);
    }
  });

  it('getEndpoint throws for unknown name', () => {
    expect(() => getEndpoint('nonexistent' as EndpointName)).toThrow(
      'Unknown endpoint: nonexistent',
    );
  });

  it('every endpoint has non-empty description', () => {
    for (const ep of WATCHER_ENDPOINTS) {
      expect(ep.description.length).toBeGreaterThan(0);
    }
  });

  it('every endpoint path starts with /', () => {
    for (const ep of WATCHER_ENDPOINTS) {
      expect(ep.path).toMatch(/^\//);
    }
  });
});
