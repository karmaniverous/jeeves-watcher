/**
 * @module test/qdrant/ephemeralQdrant
 * Provision a throwaway Qdrant for one test run: the cached official release binary first, Docker second; `undefined` when neither works (reasons returned).
 * Network, fs and child-process I/O via {@link ensureQdrantBinary}, {@link startBinaryQdrant} and {@link startDockerQdrant}.
 */

import { startBinaryQdrant } from './binary';
import { startDockerQdrant } from './docker';
import { ensureQdrantBinary } from './download';

/** A running throwaway Qdrant. */
export interface EphemeralQdrant {
  /** REST base URL, e.g. `http://127.0.0.1:51234`. */
  url: string;
  /** How it was provisioned. */
  kind: 'binary' | 'docker';
  /** Human-readable detail for logs (pid and dir, or container id). */
  detail: string;
  /** Stop it and delete all of its state. */
  stop: () => Promise<void>;
}

/** Outcome of {@link provisionEphemeralQdrant}. */
export interface ProvisionResult {
  /** The instance, when one could be started. */
  qdrant?: EphemeralQdrant;
  /** Why each attempted strategy failed. */
  failures: string[];
}

/** A provisioning strategy. */
export interface Strategy {
  /** Name for failure messages. */
  name: string;
  /** Start an instance. */
  start: () => Promise<EphemeralQdrant>;
}

/** Default strategies, in order of preference. */
const DEFAULT_STRATEGIES: Strategy[] = [
  {
    name: 'release binary',
    start: async () => startBinaryQdrant(await ensureQdrantBinary()),
  },
  { name: 'docker', start: startDockerQdrant },
];

/**
 * Try each strategy in order; return the first instance that starts.
 *
 * @param strategies - Strategies to try (default: release binary, then Docker).
 * @returns The instance (if any) and the failures of earlier strategies.
 */
export async function provisionEphemeralQdrant(
  strategies: Strategy[] = DEFAULT_STRATEGIES,
): Promise<ProvisionResult> {
  const failures: string[] = [];
  for (const strategy of strategies) {
    try {
      return { qdrant: await strategy.start(), failures };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${strategy.name}: ${message}`);
    }
  }
  return { failures };
}
