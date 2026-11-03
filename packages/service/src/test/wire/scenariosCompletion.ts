/**
 * @module test/wire/scenariosCompletion
 * Wire scenarios for the 22 routes the catalog completion (Dev Plan P4, spec A1) switches: every outcome a route has, one unknown-key request per route that takes a body or query, query-string variants of the not-found answers, and each `/vcs/*` route with VCS off. Recorded from tag `service/0.20.0` by `scripts/capture-wire-0.20.0.mjs`. No I/O.
 */

import type { WireScenario } from './scenarios';
import type { WireState } from './wireApp';

const post = (
  name: string,
  url: string,
  payload: unknown,
  state?: Partial<WireState>,
): WireScenario => ({ name, method: 'POST', url, payload, state });

const del = (name: string, url: string, payload?: unknown): WireScenario => ({
  name,
  method: 'DELETE',
  url,
  ...(payload === undefined ? {} : { payload }),
});

const get = (
  name: string,
  url: string,
  extra: Partial<WireScenario> = {},
): WireScenario => ({ name, method: 'GET', url, ...extra });

const filter = { must: [{ key: 'x', match: { value: 1 } }] };

/** Each `/vcs/*` route answered with VCS off (0.20.0 has no route at all). */
const withoutVcs: readonly WireScenario[] = [
  get('vcsStatus without vcs', '/vcs/status', { withoutVcs: true }),
  get('vcsHistory without vcs', '/vcs/history?glob={root}/**', {
    withoutVcs: true,
  }),
  get('vcsDiff without vcs', '/vcs/diff?glob={root}/**&commit={commit}', {
    withoutVcs: true,
  }),
  get(
    'vcsCheckExclusion without vcs',
    '/vcs/check-exclusion?path={root}/notes.md',
    { withoutVcs: true },
  ),
  {
    ...post('vcsRevert without vcs', '/vcs/revert', {
      glob: '{root}/hello.txt',
      commit: '{commit}',
    }),
    withoutVcs: true,
  },
  {
    ...post('vcsExclude without vcs', '/vcs/exclude', {
      glob: '{root}/tmp/*.log',
    }),
    withoutVcs: true,
  },
];

/** Scenarios for the routes switched by the catalog completion. */
export const CATALOG_COMPLETION_SCENARIOS: readonly WireScenario[] = [
  // GET /config/schema, POST /config/match, POST /config/validate
  get('configSchema', '/config/schema'),
  get('configSchema unknown query', '/config/schema?x=1'),
  post('configMatch', '/config/match', { paths: ['docs/a.md', 'docs/a.txt'] }),
  post('configMatch missing paths', '/config/match', {}),
  post('configMatch paths not array', '/config/match', { paths: 'docs/a.md' }),
  post('configMatch unknown key', '/config/match', {
    paths: ['docs/a.md'],
    extra: 1,
  }),
  post('configValidate current', '/config/validate', {}),
  post('configValidate invalid', '/config/validate', {
    config: { watch: 5 },
  }),
  post('configValidate test paths', '/config/validate', {
    config: { maxDepth: 3 },
    testPaths: ['/no/such/file.md'],
  }),
  post('configValidate unknown key', '/config/validate', {
    config: {},
    extra: 1,
  }),

  // POST /reindex
  post('reindex issues dry run', '/reindex', { scope: 'issues', dryRun: true }),
  post('reindex issues', '/reindex', { scope: 'issues' }),
  post('reindex default scope dry run', '/reindex', { dryRun: true }),
  post('reindex unknown scope', '/reindex', { scope: 'everything' }),
  post('reindex source dry run', '/reindex', {
    scope: 'path',
    source: 'app://chat/1',
    dryRun: true,
  }),
  {
    ...post('reindex source without queue', '/reindex', {
      scope: 'path',
      source: 'app://chat/1',
    }),
    withoutSourceQueue: true,
  },
  post('reindex prune dry run', '/reindex', { scope: 'prune', dryRun: true }),
  post('reindex unknown key', '/reindex', {
    scope: 'issues',
    dryRun: true,
    extra: 1,
  }),

  // GET /issues, GET /search/facets, POST /rebuild-metadata
  get('issues', '/issues'),
  get('facets', '/search/facets'),
  get('facets unknown query', '/search/facets?x=1'),
  post('rebuildMetadata', '/rebuild-metadata', {}),
  post('rebuildMetadata unknown key', '/rebuild-metadata', { extra: 1 }),

  // POST /metadata
  post('metadata file', '/metadata', {
    path: 'docs/a.md',
    metadata: { title: 'New' },
  }),
  post('metadata source', '/metadata', {
    source: 'app://chat/1',
    metadata: { title: 'New' },
  }),
  post(
    'metadata source not indexed',
    '/metadata',
    { source: 'app://chat/1', metadata: { title: 'New' } },
    { sourceRule: null },
  ),
  post('metadata neither target', '/metadata', { metadata: { title: 'x' } }),
  post('metadata missing metadata', '/metadata', { path: 'docs/a.md' }),
  post('metadata unknown key', '/metadata', {
    path: 'docs/a.md',
    metadata: { title: 'New' },
    extra: 1,
  }),

  // POST /walk
  post('walk', '/walk', { globs: ['**/*.md'] }),
  post('walk missing globs', '/walk', {}),
  post('walk scanning', '/walk', { globs: ['**/*.md'] }, { walk: 'scanning' }),
  post('walk no watcher', '/walk', { globs: ['**/*.md'] }, { walk: 'absent' }),
  post('walk unknown key', '/walk', { globs: ['**/*.md'], extra: 1 }),

  // POST /documents
  post('documents accepted', '/documents', {
    documents: [{ source: 'app://chat/1', rule: 'chat' }],
  }),
  post('documents wait', '/documents?wait=true', {
    documents: [{ source: 'app://chat/1', rule: 'chat' }],
  }),
  post('documents invalid reference', '/documents', {
    documents: [{ source: 'not a reference', rule: 'chat' }],
  }),
  {
    ...post('documents without queue', '/documents', {
      documents: [{ source: 'app://chat/1', rule: 'chat' }],
    }),
    withoutSourceQueue: true,
  },
  post('documents empty body', '/documents', {}),
  post('documents unknown key', '/documents', {
    documents: [{ source: 'app://chat/1', rule: 'chat' }],
    extra: 1,
  }),

  // POST /documents/delete
  post('documentsDelete sources', '/documents/delete', {
    sources: ['app://chat/1'],
  }),
  post(
    'documentsDelete filter',
    '/documents/delete',
    { filter },
    { sourcePoint: true },
  ),
  post('documentsDelete empty body', '/documents/delete', {}),
  post('documentsDelete both selectors', '/documents/delete', {
    sources: ['app://chat/1'],
    filter,
  }),
  post(
    'documentsDelete filter rejected',
    '/documents/delete',
    { filter },
    { filterRejected: true },
  ),
  post('documentsDelete unknown key', '/documents/delete', {
    sources: ['app://chat/1'],
    extra: 1,
  }),

  // POST /points/delete
  post('pointsDelete', '/points/delete', { filter }),
  post('pointsDelete missing filter', '/points/delete', {}),
  post(
    'pointsDelete filter rejected',
    '/points/delete',
    { filter },
    { filterRejected: true },
  ),
  post('pointsDelete unknown key', '/points/delete', { filter, extra: 1 }),

  // Virtual rules
  post('rulesRegister', '/rules/register', {
    source: 'plug',
    rules: [{ name: 'plug-rule', match: { type: 'object' }, schema: [] }],
  }),
  post('rulesRegister invalid rules', '/rules/register', {
    source: 'plug',
    rules: [{ name: 'plug-rule', match: 5 }],
  }),
  post('rulesRegister missing source', '/rules/register', { rules: [] }),
  post('rulesRegister unknown key', '/rules/register', {
    source: 'plug',
    rules: [],
    extra: 1,
  }),
  del('rulesUnregister', '/rules/unregister', { source: 'plug' }),
  del('rulesUnregister missing source', '/rules/unregister', {}),
  del('rulesUnregister unknown key', '/rules/unregister', {
    source: 'plug',
    extra: 1,
  }),
  del('rulesUnregisterBySource', '/rules/unregister/plug'),
  post('rulesReapply', '/rules/reapply', { globs: ['**/*.md'] }),
  post('rulesReapply missing globs', '/rules/reapply', {}),
  post('rulesReapply unknown key', '/rules/reapply', {
    globs: ['**/*.md'],
    extra: 1,
  }),

  // Version history
  get('vcsStatus', '/vcs/status'),
  get('vcsHistory', '/vcs/history?glob={root}/**'),
  get('vcsHistory limit', '/vcs/history?glob={root}/**&limit=1'),
  get('vcsHistory missing glob', '/vcs/history'),
  get('vcsHistory unknown root', '/vcs/history?glob=/elsewhere/**'),
  get('vcsHistory unknown key', '/vcs/history?glob={root}/**&x=1'),
  get('vcsDiff', '/vcs/diff?glob={root}/**&commit={commit}~1'),
  get(
    'vcsDiff range',
    '/vcs/diff?glob={root}/**&commit={commit}~1&commitEnd={commit}',
  ),
  get('vcsDiff missing commit', '/vcs/diff?glob={root}/**'),
  get('vcsDiff unknown root', '/vcs/diff?glob=/elsewhere/**&commit={commit}'),
  get('vcsCheckExclusion', '/vcs/check-exclusion?path={root}/notes.md'),
  get('vcsCheckExclusion missing path', '/vcs/check-exclusion'),
  get(
    'vcsCheckExclusion unknown root',
    '/vcs/check-exclusion?path=/elsewhere/a.md',
  ),
  post('vcsRevert', '/vcs/revert', {
    glob: '{root}/hello.txt',
    commit: '{commit}',
  }),
  post('vcsRevert existing only', '/vcs/revert', {
    glob: '{root}/**',
    commit: '{commit}',
    existingOnly: true,
  }),
  post('vcsRevert missing commit', '/vcs/revert', { glob: '{root}/hello.txt' }),
  post('vcsRevert unknown root', '/vcs/revert', {
    glob: '/elsewhere/a.md',
    commit: '{commit}',
  }),
  post('vcsRevert unknown key', '/vcs/revert', {
    glob: '{root}/hello.txt',
    commit: '{commit}',
    extra: 1,
  }),
  post('vcsExclude add', '/vcs/exclude', { glob: '{root}/tmp/*.log' }),
  post('vcsExclude add with root', '/vcs/exclude', {
    glob: '{root}/tmp/*.log',
    root: '{root}',
  }),
  post('vcsExclude remove absent', '/vcs/exclude', {
    glob: '{root}/tmp/*.log',
    remove: true,
  }),
  post('vcsExclude missing glob', '/vcs/exclude', {}),
  post('vcsExclude unknown root', '/vcs/exclude', { glob: '/elsewhere/*.log' }),
  post('vcsExclude root not vcs', '/vcs/exclude', {
    glob: '{root}/tmp/*.log',
    root: '/elsewhere',
  }),
  post('vcsExclude unknown key', '/vcs/exclude', {
    glob: '{root}/tmp/*.log',
    extra: 1,
  }),
  ...withoutVcs,
];
