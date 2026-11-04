/**
 * @module api/vcsHealthSource.test
 * health.vcs is wired only when some root has VCS enabled (Design 6 Health).
 */

import { describe, expect, it } from 'vitest';

import { vcsHealthSource } from './vcsHealthSource';

const health = { roots: 1, pending: 0, trippedRoots: 0, oldestTrippedAt: null };

describe('vcsHealthSource', () => {
  it('is empty without a coordinator or with no VCS-enabled root', () => {
    expect(vcsHealthSource()).toEqual({});
    expect(
      vcsHealthSource({ getRoots: () => [], getHealth: () => health }),
    ).toEqual({});
  });

  it('reports the coordinator health when a root has VCS enabled', () => {
    const source = vcsHealthSource({
      getRoots: () => ['/r'],
      getHealth: () => health,
    });
    expect(source.getVcsHealth?.()).toEqual(health);
  });
});
