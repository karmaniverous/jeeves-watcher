/**
 * @module test/qdrant/ephemeralQdrant.test
 * Tests for strategy ordering in throwaway-Qdrant provisioning (fake strategies; no binaries or Docker).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type EphemeralQdrant,
  provisionEphemeralQdrant,
  type Strategy,
} from './ephemeralQdrant';

const instance: EphemeralQdrant = {
  url: 'http://127.0.0.1:50000',
  kind: 'docker',
  detail: 'container abc',
  stop: () => Promise.resolve(),
};

const failing = (name: string, message: string): Strategy => ({
  name,
  start: () => Promise.reject(new Error(message)),
});

describe('provisionEphemeralQdrant', () => {
  it('returns the first strategy that starts and skips the rest', async () => {
    const later = vi.fn(() => Promise.resolve(instance));
    const result = await provisionEphemeralQdrant([
      { name: 'first', start: () => Promise.resolve(instance) },
      { name: 'second', start: later },
    ]);
    expect(result.qdrant).toBe(instance);
    expect(result.failures).toEqual([]);
    expect(later).not.toHaveBeenCalled();
  });

  it('falls back and records why earlier strategies failed', async () => {
    const result = await provisionEphemeralQdrant([
      failing('release binary', 'offline'),
      { name: 'docker', start: () => Promise.resolve(instance) },
    ]);
    expect(result.qdrant).toBe(instance);
    expect(result.failures).toEqual(['release binary: offline']);
  });

  it('returns no instance when every strategy fails', async () => {
    const result = await provisionEphemeralQdrant([
      failing('release binary', 'unsupported platform'),
      failing('docker', 'docker not found'),
    ]);
    expect(result.qdrant).toBeUndefined();
    expect(result.failures).toEqual([
      'release binary: unsupported platform',
      'docker: docker not found',
    ]);
  });

  it('records a strategy rejecting with a non-Error value as text', async () => {
    const result = await provisionEphemeralQdrant([
      {
        name: 'docker',
        start: vi
          .fn<Strategy['start']>()
          .mockRejectedValue('daemon not running'),
      },
    ]);
    expect(result.failures).toEqual(['docker: daemon not running']);
  });
});
