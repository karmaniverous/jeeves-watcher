/**
 * Shared endpoint catalog — single source of truth for the jeeves-watcher API.
 *
 * Both the CLI service and the OpenClaw plugin derive their registrations
 * from this declarative catalog, eliminating drift between the two.
 *
 */

/** HTTP methods used by the API. */
export type HttpMethod = 'DELETE' | 'GET' | 'POST';

/** Descriptor for a single API endpoint. */
export interface EndpointDescriptor {
  /** Unique endpoint identifier (camelCase). */
  name: string;
  /** HTTP method. */
  method: HttpMethod;
  /** URL path pattern (e.g. '/search'). */
  path: string;
  /** Human-readable description of the endpoint's purpose. */
  description: string;
}

/**
 * Canonical endpoint catalog for the jeeves-watcher API.
 *
 * Every entry describes a single HTTP endpoint exposed by the service.
 * Route handlers, plugin tools, and HTTP clients should reference these
 * descriptors rather than hard-coding paths and descriptions.
 */
export const WATCHER_ENDPOINTS = [
  {
    name: 'status',
    method: 'GET',
    path: '/status',
    description: 'Service health and status overview.',
  },
  {
    name: 'metadata',
    method: 'POST',
    path: '/metadata',
    description: 'Set or update metadata on a document by file path.',
  },
  {
    name: 'render',
    method: 'POST',
    path: '/render',
    description: 'Render a document through the template pipeline.',
  },
  {
    name: 'searchFacets',
    method: 'GET',
    path: '/search/facets',
    description: 'List available search facets and their values.',
  },
  {
    name: 'scan',
    method: 'POST',
    path: '/scan',
    description:
      'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter.',
  },
  {
    name: 'walk',
    method: 'POST',
    path: '/walk',
    description:
      'Walk watched filesystem paths with glob intersection. Returns matching file paths.',
  },
  {
    name: 'search',
    method: 'POST',
    path: '/search',
    description:
      'Semantic search over indexed documents. Supports Qdrant filters.',
  },
  {
    name: 'rebuildMetadata',
    method: 'POST',
    path: '/rebuild-metadata',
    description: 'Rebuild metadata from enrichment store into vector points.',
  },
  {
    name: 'reindex',
    method: 'POST',
    path: '/reindex',
    description: 'Trigger a scoped reindex of watched files.',
  },
  {
    name: 'issues',
    method: 'GET',
    path: '/issues',
    description:
      'Get runtime embedding failures. Shows files that failed processing and why.',
  },
  {
    name: 'configSchema',
    method: 'GET',
    path: '/config/schema',
    description: 'Get the JSON Schema for the configuration file.',
  },
  {
    name: 'configMatch',
    method: 'POST',
    path: '/config/match',
    description: 'Test file paths against config inference rules.',
  },
  {
    name: 'config',
    method: 'GET',
    path: '/config',
    description: 'Query service configuration with optional JSONPath.',
  },
  {
    name: 'configValidate',
    method: 'POST',
    path: '/config/validate',
    description:
      'Validate a candidate config. Optionally test file paths against the config.',
  },
  {
    name: 'configApply',
    method: 'POST',
    path: '/config/apply',
    description: 'Apply a configuration patch.',
  },
  {
    name: 'rulesRegister',
    method: 'POST',
    path: '/rules/register',
    description: 'Register external inference rules.',
  },
  {
    name: 'rulesUnregister',
    method: 'DELETE',
    path: '/rules/unregister',
    description: 'Unregister external inference rules.',
  },
  {
    name: 'rulesUnregisterBySource',
    method: 'DELETE',
    path: '/rules/unregister/:source',
    description: 'Unregister all external inference rules from a source.',
  },
  {
    name: 'pointsDelete',
    method: 'POST',
    path: '/points/delete',
    description: 'Delete points from the vector store by filter.',
  },
  {
    name: 'rulesReapply',
    method: 'POST',
    path: '/rules/reapply',
    description: 'Re-apply inference rules to existing vector points.',
  },
  {
    name: 'vcsStatus',
    method: 'GET',
    path: '/vcs/status',
    description:
      'VCS state for all roots: enabled state, tracked files, last commit, remote status.',
  },
  {
    name: 'vcsHistory',
    method: 'GET',
    path: '/vcs/history',
    description:
      'Query change history by path or glob with optional date range.',
  },
  {
    name: 'vcsShow',
    method: 'GET',
    path: '/vcs/show',
    description: 'Retrieve file content at a specific version.',
  },
  {
    name: 'vcsDiff',
    method: 'GET',
    path: '/vcs/diff',
    description:
      'Show what changed between two versions, or between a version and current.',
  },
  {
    name: 'vcsCheckExclusion',
    method: 'GET',
    path: '/vcs/check-exclusion',
    description:
      'Check whether a path is excluded from version tracking and why.',
  },
  {
    name: 'vcsRevert',
    method: 'POST',
    path: '/vcs/revert',
    description:
      'Restore files from a historical commit (forward-only reversion).',
  },
  {
    name: 'vcsExclude',
    method: 'POST',
    path: '/vcs/exclude',
    description: 'Manage .gitignore entries for version tracking exclusion.',
  },
] as const satisfies readonly EndpointDescriptor[];

/** Union of all endpoint names. */
export type EndpointName = (typeof WATCHER_ENDPOINTS)[number]['name'];

/** Single entry from the catalog, narrowed by name. */
export type Endpoint<N extends EndpointName> = Extract<
  (typeof WATCHER_ENDPOINTS)[number],
  { name: N }
>;

/**
 * Look up an endpoint descriptor by name.
 *
 * @param name - The endpoint identifier.
 * @returns The matching {@link EndpointDescriptor}.
 */
export function getEndpoint<N extends EndpointName>(name: N): Endpoint<N> {
  const ep = WATCHER_ENDPOINTS.find((e) => e.name === name);
  if (!ep) throw new Error(`Unknown endpoint: ${name}`);
  return ep as Endpoint<N>;
}
