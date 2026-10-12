/**
 * @module test/globalSetup
 * Vitest global setup: probes Qdrant availability and sets QDRANT_AVAILABLE env var.
 * Integration tests use this flag to skip when Qdrant is not reachable, unless
 * QDRANT_REQUIRED=true (CI), in which case an unreachable Qdrant fails the run.
 * Teardown sweeps leftover `jeeves_watcher_it_*` collections, never anything else.
 */

import { dropLeftoverTestCollections } from './harness/qdrant';

export async function setup(): Promise<void> {
  const url = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      process.env['QDRANT_AVAILABLE'] = 'true';
      return;
    }
  } catch {
    // Qdrant unreachable
  }

  process.env['QDRANT_AVAILABLE'] = 'false';
  if (process.env['QDRANT_REQUIRED'] === 'true') {
    throw new Error(
      `[globalSetup] QDRANT_REQUIRED is set but Qdrant is not reachable at ${url}.`,
    );
  }
  console.warn(
    `[globalSetup] Qdrant not reachable at ${url} — integration tests will be skipped.`,
  );
}

/**
 * End-of-run sweep: drop any harness collection (`jeeves_watcher_it_*`) a
 * suite failed to clean up. Collections without the prefix are never
 * listed for deletion, so a shared (even production) Qdrant is safe.
 */
export async function teardown(): Promise<void> {
  if (process.env['QDRANT_AVAILABLE'] !== 'true') return;
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
