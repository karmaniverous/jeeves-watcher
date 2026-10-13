/**
 * @module test/globalSetup.test
 * Vitest global setup with its Qdrant I/O mocked: a configured QDRANT_URL is probed and guarded; otherwise a throwaway Qdrant is provisioned, guarded and exported; unavailable Qdrant skips or fails under QDRANT_REQUIRED; teardown sweeps this run's collections and stops the throwaway instance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setup, teardown } from './globalSetup';
import type * as HarnessQdrant from './harness/qdrant';
import {
  dropLeftoverTestCollections,
  GUARDED_URL_ENV,
  RUN_ID_ENV,
} from './harness/qdrant';
import {
  type EphemeralQdrant,
  provisionEphemeralQdrant,
} from './qdrant/ephemeralQdrant';
import { probeQdrant } from './qdrant/readiness';
import { assertNotSharedQdrant } from './qdrant/sharedGuard';

vi.mock('./harness/qdrant', async (importOriginal) => ({
  ...(await importOriginal<typeof HarnessQdrant>()),
  dropLeftoverTestCollections: vi.fn(),
}));
vi.mock('./qdrant/ephemeralQdrant', () => ({
  provisionEphemeralQdrant: vi.fn(),
}));
vi.mock('./qdrant/readiness', () => ({ probeQdrant: vi.fn() }));
vi.mock('./qdrant/sharedGuard', () => ({ assertNotSharedQdrant: vi.fn() }));

const CONFIGURED = 'http://127.0.0.1:6333';
const THROWAWAY = 'http://127.0.0.1:50123';

/** Every env var the setup reads or writes, isolated per test. */
const ENV_KEYS = [
  'QDRANT_URL',
  'QDRANT_AVAILABLE',
  'QDRANT_REQUIRED',
  GUARDED_URL_ENV,
  RUN_ID_ENV,
];

function throwaway(): EphemeralQdrant & { stop: ReturnType<typeof vi.fn> } {
  return {
    url: THROWAWAY,
    kind: 'binary',
    detail: 'pid 1',
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

describe('globalSetup', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.mocked(probeQdrant).mockResolvedValue(true);
    vi.mocked(assertNotSharedQdrant).mockResolvedValue(undefined);
    vi.mocked(dropLeftoverTestCollections).mockResolvedValue([]);
  });

  afterEach(async () => {
    // Release any throwaway instance a test left registered.
    await teardown();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('probes and guards a configured QDRANT_URL, then exports it as guarded', async () => {
    vi.stubEnv('QDRANT_URL', CONFIGURED);
    await setup();
    expect(probeQdrant).toHaveBeenCalledWith(`${CONFIGURED}/healthz`);
    expect(assertNotSharedQdrant).toHaveBeenCalledWith(CONFIGURED);
    expect(provisionEphemeralQdrant).not.toHaveBeenCalled();
    expect(process.env[GUARDED_URL_ENV]).toBe(CONFIGURED);
    expect(process.env['QDRANT_AVAILABLE']).toBe('true');
    expect(process.env[RUN_ID_ENV]).toMatch(/^r[a-z0-9]{8}$/);
  });

  it('skips integration suites when a configured Qdrant is unreachable, and fails when required', async () => {
    vi.stubEnv('QDRANT_URL', CONFIGURED);
    vi.mocked(probeQdrant).mockResolvedValue(false);
    await setup();
    expect(process.env['QDRANT_AVAILABLE']).toBe('false');
    expect(process.env[GUARDED_URL_ENV]).toBeUndefined();
    expect(assertNotSharedQdrant).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Qdrant is not reachable at ${CONFIGURED}`),
    );

    vi.stubEnv('QDRANT_REQUIRED', 'true');
    await expect(setup()).rejects.toThrow(
      /QDRANT_REQUIRED is set but Qdrant is not reachable/,
    );
  });

  it('provisions, guards and exports a throwaway Qdrant; teardown sweeps and stops it', async () => {
    const qdrant = throwaway();
    vi.mocked(provisionEphemeralQdrant).mockResolvedValue({
      qdrant,
      failures: [],
    });
    vi.mocked(dropLeftoverTestCollections).mockResolvedValue(['left_over']);
    await setup();
    expect(assertNotSharedQdrant).toHaveBeenCalledWith(THROWAWAY);
    expect(process.env['QDRANT_URL']).toBe(THROWAWAY);
    expect(process.env[GUARDED_URL_ENV]).toBe(THROWAWAY);
    expect(process.env['QDRANT_AVAILABLE']).toBe('true');

    await teardown();
    expect(dropLeftoverTestCollections).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(
      '[globalSetup] dropped leftover test collections: left_over',
    );
    expect(qdrant.stop).toHaveBeenCalledOnce();
    expect(process.env['QDRANT_URL']).toBeUndefined();
    expect(process.env[GUARDED_URL_ENV]).toBeUndefined();
  });

  it('stops the throwaway Qdrant and rethrows when the shared-instance guard refuses it', async () => {
    const qdrant = throwaway();
    vi.mocked(provisionEphemeralQdrant).mockResolvedValue({
      qdrant,
      failures: [],
    });
    vi.mocked(assertNotSharedQdrant).mockRejectedValue(new Error('shared!'));
    await expect(setup()).rejects.toThrow('shared!');
    expect(qdrant.stop).toHaveBeenCalledOnce();
    expect(process.env['QDRANT_URL']).toBeUndefined();
    expect(process.env['QDRANT_AVAILABLE']).toBeUndefined();
  });

  it('reports every provisioning failure, and fails when required', async () => {
    vi.mocked(provisionEphemeralQdrant).mockResolvedValue({
      failures: ['binary: no network', 'docker: not installed'],
    });
    await setup();
    expect(process.env['QDRANT_AVAILABLE']).toBe('false');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/binary: no network\n {2}docker: not installed/),
    );

    vi.stubEnv('QDRANT_REQUIRED', 'true');
    await expect(setup()).rejects.toThrow(
      /no throwaway Qdrant could be started/,
    );
  });

  it('still stops the throwaway Qdrant when the teardown sweep fails', async () => {
    const qdrant = throwaway();
    vi.mocked(provisionEphemeralQdrant).mockResolvedValue({
      qdrant,
      failures: [],
    });
    await setup();
    vi.mocked(dropLeftoverTestCollections).mockRejectedValue(new Error('down'));
    await teardown();
    expect(console.warn).toHaveBeenCalledWith(
      '[globalSetup] leftover collection sweep failed',
      expect.any(Error),
    );
    expect(qdrant.stop).toHaveBeenCalledOnce();
  });
});
