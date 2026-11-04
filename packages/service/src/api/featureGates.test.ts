/**
 * @module api/featureGates.test
 * `routeKey` (HEAD keyed as GET) and `disabledRoutes`: exactly the gated entries whose feature is off, keyed by method and route path; ungated entries never.
 */

import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { disabledRoutes, routeKey } from './featureGates';

describe('routeKey', () => {
  it('keys a request by method and route path', () => {
    expect(routeKey('POST', '/vcs/revert')).toBe('POST /vcs/revert');
  });

  it('keys HEAD as GET', () => {
    expect(routeKey('HEAD', '/vcs/status')).toBe('GET /vcs/status');
  });
});

describe('disabledRoutes', () => {
  it('disables every /vcs/* route while VCS is off', () => {
    const disabled = disabledRoutes(WATCHER_CATALOG.entries, { vcs: false });

    expect([...disabled].sort()).toEqual([
      'GET /vcs/check-exclusion',
      'GET /vcs/diff',
      'GET /vcs/history',
      'GET /vcs/show',
      'GET /vcs/status',
      'POST /vcs/exclude',
      'POST /vcs/revert',
    ]);
  });

  it('disables nothing while VCS is on', () => {
    expect(disabledRoutes(WATCHER_CATALOG.entries, { vcs: true }).size).toBe(0);
  });

  it('never disables an ungated entry', () => {
    const entries = [
      { name: 'status', method: 'GET', path: '/status' },
      { name: 'vcsShow', method: 'GET', path: '/vcs/show' },
    ];

    expect([...disabledRoutes(entries, { vcs: false })]).toEqual([
      'GET /vcs/show',
    ]);
  });
});
