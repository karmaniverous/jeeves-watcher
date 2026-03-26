/**
 * @module test/globalSetup
 * Vitest global setup: probes Qdrant availability and sets QDRANT_AVAILABLE env var.
 * Integration tests use this flag to skip when Qdrant is not reachable.
 */

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
  console.warn(
    `[globalSetup] Qdrant not reachable at ${url} — integration tests will be skipped.`,
  );
}
