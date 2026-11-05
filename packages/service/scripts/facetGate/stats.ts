/**
 * @module scripts/facetGate/stats
 * Pure helpers of the facet latency gate (D104, D155): latency summaries, field selection from payload key counts, the three gate workloads, and command-line options. No I/O.
 */

/** Latency summary of one workload, ms. */
export interface LatencySummary {
  /** Median. */
  p50: number;
  /** 95th percentile (nearest rank). */
  p95: number;
  /** Slowest. */
  max: number;
}

/**
 * Nearest-rank percentile summary of a set of latencies.
 *
 * @param samples - Latencies, ms (at least one).
 * @returns p50, p95 and max, rounded to 0.1 ms.
 */
export function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) throw new Error('no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    p50: round(rank(0.5)),
    p95: round(rank(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

/** Payload keys never offered as facet fields (positions, hashes, paths, text). */
export const NON_FACET_KEYS: ReadonlySet<string> = new Set([
  'chunk_index',
  'chunk_text',
  'total_chunks',
  'line_start',
  'line_end',
  'created_at',
  'modified_at',
  'message_ts',
  'content_hash',
  'file_path',
]);

/**
 * The most common payload keys, as P2 chose them: `matched_rules` always
 * included, positions and hashes skipped.
 *
 * @param keyCounts - Points holding each key.
 * @param count - How many fields.
 * @returns The fields, most common first.
 */
export function pickFacetFields(
  keyCounts: ReadonlyMap<string, number>,
  count: number,
): string[] {
  const fields = [...keyCounts.entries()]
    .filter(([key]) => !NON_FACET_KEYS.has(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  if (!fields.includes('matched_rules')) fields.unshift('matched_rules');
  return fields.slice(0, count);
}

/** One gate workload: a `countFacets` body and its p95 ceiling. */
export interface Workload {
  /** Label. */
  name: string;
  /** Request body. */
  body: Record<string, unknown>;
  /** p95 ceiling, ms. */
  p95Max: number;
}

/**
 * The three gate workloads (D104, D155): 4 fields under an equality tenant
 * filter (200 ms), 20 fields unfiltered (500 ms), and the 4 fields under
 * the tenant filter with `rules` naming 2 rules (200 ms).
 *
 * @param fields - The 20 facet fields.
 * @param tenantField - Tenant payload field.
 * @param tenant - Tenant value.
 * @param rules - Two rule names.
 * @returns The workloads.
 */
export function gateWorkloads(
  fields: readonly string[],
  tenantField: string,
  tenant: string,
  rules: readonly string[],
): Workload[] {
  const four = fields.filter((f) => f !== tenantField).slice(0, 4);
  const filter = { must: [{ key: tenantField, match: { value: tenant } }] };
  return [
    {
      name: 'W1 4 fields, tenant filter',
      body: { filter, fields: four },
      p95Max: 200,
    },
    {
      name: 'W2 20 fields, unfiltered',
      body: { fields: [...fields] },
      p95Max: 500,
    },
    {
      name: 'W3 4 fields, tenant filter + 2 rules',
      body: { filter, rules: [...rules], fields: four },
      p95Max: 200,
    },
  ];
}

/** Gate options. */
export interface GateOptions {
  /** Source Qdrant URL (read only: GET and scroll). */
  sourceUrl: string;
  /** Source collection. */
  sourceCollection: string;
  /** Point floor of the copy (the copy is never smaller than the source). */
  floor: number;
  /** Tenant payload field. */
  tenantField: string;
  /** Warm-up requests per workload. */
  warmup: number;
  /** Timed requests per workload. */
  runs: number;
  /** Where to write the JSON result. */
  out?: string;
}

/**
 * Parse `--key value` options.
 *
 * @param argv - Arguments after the script name.
 * @returns The options.
 * @throws When `--source-collection` is missing or a number is invalid.
 */
export function parseGateArgs(argv: readonly string[]): GateOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv.at(i + 1);
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`Expected --key value pairs, got ${key}`);
    }
    args.set(key.slice(2), value);
  }
  const num = (key: string, fallback: number) => {
    const raw = args.get(key);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`--${key} must be a positive integer`);
    }
    return value;
  };
  const sourceCollection = args.get('source-collection');
  if (!sourceCollection) throw new Error('--source-collection is required');
  return {
    sourceUrl: args.get('source-url') ?? 'http://127.0.0.1:6333',
    sourceCollection,
    floor: num('floor', 864_000),
    tenantField: args.get('tenant-field') ?? 'silo',
    warmup: num('warmup', 5),
    runs: num('runs', 60),
    out: args.get('out'),
  };
}
