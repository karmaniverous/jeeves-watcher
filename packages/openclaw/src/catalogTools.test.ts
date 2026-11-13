/**
 * @module plugin/catalogTools.test
 * Tests for the catalog-built toolset: the tool-name rule (D77), registration order, each rebuilt domain tool's request (method, path, query, body, bearer key), the destructive annotation, the 120 s timeout (D137), the error format (D31), and that every `watcher_*` name in the prompt rules and the skill is a built tool (Design 14).
 */

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type ToolDescriptor,
  type ToolRegistrationOptions,
} from '@karmaniverous/jeeves';
import {
  catalogToolDefinition,
  toToolName,
} from '@karmaniverous/jeeves/catalog';
import {
  WATCHER_CATALOG,
  WATCHER_PROMPT_RULES,
  WATCHER_SKILL,
} from '@karmaniverous/jeeves-watcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCatalogTools,
  registerCatalogTool,
  VCS_EXCLUDE_DESCRIPTION,
  WATCHER_TOOL_NAMES,
  WATCHER_TOOL_SELECTION,
} from './catalogTools.js';
import { renamedTool } from './test/toolRenames.js';
import { createWatcherComponent } from './watcherComponent.js';

const BASE = 'http://127.0.0.1:1936';
const KEY = 'plugin-test-key';

const tools = createCatalogTools(
  {
    pluginConfig: { apiUrl: BASE, apiKey: KEY },
    registerTool: () => undefined,
  },
  createWatcherComponent('0.0.0-test'),
);

/** A tool by name (throws when it was not built). */
function tool(name: string): ToolDescriptor {
  const found = tools.get(name);
  if (!found) throw new Error(`not built: ${name}`);
  return found;
}

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

/** Answer every request with `status` and `body` (JSON unless a string). */
function respond(status: number, body: unknown = {}): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: {
          'content-type':
            typeof body === 'string' ? 'text/plain' : 'application/json',
        },
      }),
    ),
  );
}

/** Method, path, query and body of the first request. */
function sent() {
  const [url, init] = fetchMock.mock.calls[0];
  const parsed = new URL(url);
  return {
    method: init?.method,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
    authorization: new Headers(init?.headers).get('authorization'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('createCatalogTools', () => {
  it('builds the 4 standard tools and the 18 domain tools', () => {
    expect([...tools.keys()].sort()).toEqual([...WATCHER_TOOL_NAMES].sort());
    expect(WATCHER_TOOL_NAMES).toHaveLength(22);
  });

  it('gives the four D206 read tools no catalogMode (deferred) and leaves nine entries untooled', () => {
    const selections = new Map<string, object>(
      Object.entries(WATCHER_TOOL_SELECTION),
    );
    for (const entry of [
      'listFacets',
      'countFacets',
      'render',
      'matchConfig',
    ]) {
      const selection = selections.get(entry);
      expect(selection).toBeDefined();
      expect(selection && 'catalogMode' in selection).toBe(false);
    }
    const tooled = new Set([
      'status',
      'config',
      'configApply',
      ...Object.keys(WATCHER_TOOL_SELECTION),
    ]);
    expect(
      WATCHER_CATALOG.entries
        .map((entry) => entry.name)
        .filter((name) => !tooled.has(name))
        .sort(),
    ).toEqual(
      [
        'getConfigSchema',
        'notifyDocuments',
        'registerRules',
        'reapplyRules',
        'rebuildMetadata',
        'deleteDocuments',
        'deletePoints',
        'unregisterRules',
        'unregisterRulesBySource',
      ].sort(),
    );
  });

  it('names every domain tool watcher_ + its entry name in snake_case (D77)', () => {
    const names = Object.keys(WATCHER_TOOL_SELECTION).map((entry) => {
      expect(WATCHER_CATALOG.byName(entry as 'search').name).toBe(entry);
      return toToolName('watcher', entry);
    });
    expect(names).toEqual(WATCHER_TOOL_NAMES.slice(4));
    for (const name of WATCHER_TOOL_NAMES) expect(name).toMatch(/^watcher_/);
  });

  it('registers in the 0.17.0 order, then the D206 tools, under the D77 names', () => {
    expect(WATCHER_TOOL_NAMES).toEqual(
      [
        'watcher_status',
        'watcher_service',
        'watcher_config',
        'watcher_config_apply',
        'watcher_search',
        'watcher_enrich',
        'watcher_validate',
        'watcher_reindex',
        'watcher_scan',
        'watcher_issues',
        'watcher_walk',
        'watcher_vcs_status',
        'watcher_vcs_history',
        'watcher_vcs_show',
        'watcher_vcs_diff',
        'watcher_vcs_revert',
        'watcher_vcs_exclude',
        'watcher_vcs_check',
      ]
        .map(renamedTool)
        .concat([
          'watcher_list_facets',
          'watcher_count_facets',
          'watcher_render',
          'watcher_match_config',
        ]),
    );
  });
});

describe('domain tools send their entry request with the bearer key', () => {
  it.each([
    [
      'watcher_set_metadata',
      { path: '/r/a.md', metadata: { k: 1 } },
      'POST',
      '/metadata',
      {},
      { path: '/r/a.md', metadata: { k: 1 } },
    ],
    ['watcher_validate_config', {}, 'POST', '/config/validate', {}, {}],
    [
      'watcher_reindex',
      { scope: 'rules', dryRun: true },
      'POST',
      '/reindex',
      {},
      { scope: 'rules', dryRun: true },
    ],
    [
      'watcher_reindex',
      { dryRun: true },
      'POST',
      '/reindex',
      {},
      { scope: 'rules', dryRun: true },
    ],
    [
      'watcher_reindex',
      { scope: 'issues' },
      'POST',
      '/reindex',
      {},
      { scope: 'issues' },
    ],
    ['watcher_list_issues', {}, 'GET', '/issues', {}, undefined],
    [
      'watcher_walk',
      { globs: ['**/*.md'] },
      'POST',
      '/walk',
      {},
      { globs: ['**/*.md'] },
    ],
    ['watcher_get_vcs_status', {}, 'GET', '/vcs/status', {}, undefined],
    [
      'watcher_list_vcs_history',
      { glob: '/r/**', limit: '5' },
      'GET',
      '/vcs/history',
      { glob: '/r/**', limit: '5' },
      undefined,
    ],
    [
      'watcher_diff_vcs',
      { glob: '/r/a.md', commit: 'abc' },
      'GET',
      '/vcs/diff',
      { glob: '/r/a.md', commit: 'abc' },
      undefined,
    ],
    [
      'watcher_revert_vcs',
      { glob: '/r/**', commit: 'abc' },
      'POST',
      '/vcs/revert',
      {},
      { glob: '/r/**', commit: 'abc' },
    ],
    [
      'watcher_exclude_vcs_path',
      { glob: '/r/drafts/**', confirm: true },
      'POST',
      '/vcs/exclude',
      {},
      { glob: '/r/drafts/**', confirm: true },
    ],
    [
      'watcher_check_vcs_exclusion',
      { path: '/r/a.md' },
      'GET',
      '/vcs/check-exclusion',
      { path: '/r/a.md' },
      undefined,
    ],
    [
      'watcher_list_facets',
      { rules: 'a,b' },
      'GET',
      '/search/facets',
      { rules: 'a,b' },
      undefined,
    ],
    [
      'watcher_count_facets',
      { fields: ['status'], filter: { must: [] } },
      'POST',
      '/search/facets/counts',
      {},
      { fields: ['status'], filter: { must: [] } },
    ],
    [
      'watcher_render',
      { path: '/r/a.md' },
      'POST',
      '/render',
      {},
      { path: '/r/a.md' },
    ],
    [
      'watcher_match_config',
      { paths: ['/r/a.md'] },
      'POST',
      '/config/match',
      {},
      { paths: ['/r/a.md'] },
    ],
  ])('%s', async (name, params, method, path, query, body) => {
    vi.stubGlobal('fetch', fetchMock);
    respond(200, {});
    await tool(name).execute('id', params);
    expect(sent()).toEqual({
      method,
      path,
      query,
      body,
      authorization: `Bearer ${KEY}`,
    });
  });
});

describe('tool behaviour', () => {
  it('builds watcher_exclude_vcs_path and watcher_revert_vcs from destructive entries, the reads from read entries', () => {
    const annotations = (
      entry: 'excludeVcsPath' | 'revertVcs' | 'listIssues',
    ) =>
      catalogToolDefinition(WATCHER_CATALOG.byName(entry), {
        prefix: 'watcher',
      }).annotations;
    expect(annotations('excludeVcsPath')).toEqual({ destructiveHint: true });
    expect(annotations('revertVcs')).toEqual({ destructiveHint: true });
    expect(annotations('listIssues')).toEqual({ readOnlyHint: true });
  });

  it('says a timeout does not cancel an exclusion (D137)', () => {
    expect(tool('watcher_exclude_vcs_path').description).toContain(
      'A timeout does not cancel the exclusion',
    );
  });

  it('gives every domain call the 120 s default timeout (D137)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    respond(200, {});
    await tool('watcher_exclude_vcs_path').execute('id', {
      glob: '/r/drafts/**',
    });
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(120_000);
    expect(timeout).toHaveBeenCalledWith(DEFAULT_FETCH_TIMEOUT_MS);
  });

  it('reports an error reply as HTTP <status>: <body> (D31)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      error: 'Not Found',
      message: 'The pattern is not excluded on this root.',
    };
    respond(404, body);
    const result = await tool('watcher_exclude_vcs_path').execute('id', {
      glob: '/r/**',
      remove: true,
    });
    expect(JSON.stringify(result)).toContain('HTTP 404');
    expect(JSON.stringify(result)).toContain('WATCHER_NOT_FOUND');
  });

  it('tells the agent a confirmRequired reply changed nothing (0.22.0)', () => {
    expect(VCS_EXCLUDE_DESCRIPTION).toContain(
      'return { confirmRequired: true, untracked } and change nothing',
    );
  });
});

describe('prompt rules and skill name only built tools (Design 14)', () => {
  const named = (text: string) =>
    [...new Set(text.match(/\bwatcher_[a-z_]+\b/g) ?? [])].sort();

  it.each([
    ['WATCHER_PROMPT_RULES', WATCHER_PROMPT_RULES],
    ['WATCHER_SKILL', WATCHER_SKILL],
  ])('%s', (_label, text) => {
    const unknown = named(text).filter((name) => !tools.has(name));
    expect(unknown).toEqual([]);
    expect(named(text).length).toBeGreaterThan(0);
  });
});

describe('registerCatalogTool', () => {
  it('registers the named tool, by identity, as optional', () => {
    const registerTool =
      vi.fn<
        (tool: ToolDescriptor, options?: ToolRegistrationOptions) => void
      >();
    registerCatalogTool({ registerTool }, tools, 'watcher_scan');
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[0]).toBe(tools.get('watcher_scan'));
    expect(registerTool.mock.calls[0]?.[1]).toEqual({ optional: true });
  });

  it('throws, registering nothing, for a tool that was not built', () => {
    const registerTool = vi.fn();
    expect(() => {
      registerCatalogTool({ registerTool }, tools, 'watcher_nope');
    }).toThrow('Catalog tool not built: watcher_nope');
    expect(registerTool).not.toHaveBeenCalled();
  });
});
