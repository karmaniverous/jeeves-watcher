/**
 * @module test/globalSetup
 * Vitest global setup: without `QDRANT_URL`, start a throwaway Qdrant (release binary, else Docker) and export its URL; with it, probe and guard that instance. Sets QDRANT_AVAILABLE.
 * Either is checked by the shared-instance guard and exported as the run's guarded URL. Unavailable Qdrant skips integration suites unless QDRANT_REQUIRED=true.
 * Teardown sweeps this run's `jeeves_watcher_it_*` collections (never another run's) and stops the throwaway instance.
 */

import {
  dropLeftoverTestCollections,
  GUARDED_URL_ENV,
  newRunId,
  RUN_ID_ENV,
} from './harness/qdrant';
import {
  type EphemeralQdrant,
  provisionEphemeralQdrant,
} from './qdrant/ephemeralQdrant';
import { assertNotSharedQdrant } from './qdrant/sharedGuard';

let ephemeral: EphemeralQdrant | undefined;

/** Mark Qdrant unavailable: fail when required, otherwise warn and skip. */
function unavailable(reason: string): void {
  process.env['QDRANT_AVAILABLE'] = 'false';
  if (process.env['QDRANT_REQUIRED'] === 'true') {
    throw new Error(`[globalSetup] QDRANT_REQUIRED is set but ${reason}`);
  }
  console.warn(
    `[globalSetup] ${reason}; Qdrant integration tests will be skipped.`,
  );
}

/** Probe an explicitly configured Qdrant. */
async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Use the Qdrant named by `QDRANT_URL` (CI service container or opt-in). */
async function useConfigured(url: string): Promise<void> {
  if (!(await healthy(url))) {
    unavailable(`Qdrant is not reachable at ${url}`);
    return;
  }
  await assertNotSharedQdrant(url);
  process.env[GUARDED_URL_ENV] = url;
  process.env['QDRANT_AVAILABLE'] = 'true';
}

/** Start a throwaway Qdrant and point the workers at it. */
async function useEphemeral(): Promise<void> {
  const { qdrant, failures } = await provisionEphemeralQdrant();
  if (!qdrant) {
    unavailable(
      `no throwaway Qdrant could be started (set QDRANT_URL to use an existing one):\n  ${failures.join('\n  ')}`,
    );
    return;
  }
  try {
    // A fresh instance holds nothing; guard anyway (e.g. a reused port).
    await assertNotSharedQdrant(qdrant.url);
  } catch (error) {
    await qdrant.stop();
    throw error;
  }
  ephemeral = qdrant;
  process.env['QDRANT_URL'] = qdrant.url;
  process.env[GUARDED_URL_ENV] = qdrant.url;
  process.env['QDRANT_AVAILABLE'] = 'true';
  console.info(
    `[globalSetup] throwaway Qdrant (${qdrant.kind}) at ${qdrant.url} (${qdrant.detail})`,
  );
}

/** Vitest global setup hook. */
export async function setup(): Promise<void> {
  process.env[RUN_ID_ENV] = newRunId();
  const configured = process.env['QDRANT_URL'];
  if (configured) await useConfigured(configured);
  else await useEphemeral();
}

/**
 * End-of-run sweep: drop any harness collection this run created that a
 * suite failed to clean up (another run's collections, and collections
 * without the prefix, are never listed for deletion), then stop the
 * throwaway Qdrant and delete its state.
 */
export async function teardown(): Promise<void> {
  if (process.env['QDRANT_AVAILABLE'] === 'true') {
    try {
      const dropped = await dropLeftoverTestCollections();
      if (dropped.length) {
        console.warn(
          `[globalSetup] dropped leftover test collections: ${dropped.join(', ')}`,
        );
      }
    } catch (error) {
      console.warn('[globalSetup] leftover collection sweep failed', error);
    }
  }
  if (ephemeral) {
    const instance = ephemeral;
    ephemeral = undefined;
    delete process.env['QDRANT_URL'];
    Reflect.deleteProperty(process.env, GUARDED_URL_ENV);
    await instance.stop();
  }
}
