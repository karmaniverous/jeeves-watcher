/**
 * @module plugin/sdkEquivalence.test
 * Result parity with 0.19.0 (D205 (3)): every HTTP tool runs through 0.19.0's call path (core's toolset, which 0.19.0 runs) and through the SDK against one local server replaying recorded watcher replies (the service's 0.20.0 wire baseline and 0.22.0 error overlay, serialised compactly as the watcher sends them; a string body is sent byte for byte), and both the requests the server receives and the results must be equal: a success and an error per tool, plus non-Fastify and non-compact bodies, a masked 500, `Retry-After`, a 401, an unreachable service and invalid input. The differences by construction (a reply the response schema does not accept, a field it does not declare, keys out of schema order) are pinned as differences.
 */

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  PluginApi,
  ToolDescriptor,
  ToolResult,
} from '@karmaniverous/jeeves';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCatalogTools,
  createCoreToolset,
  SDK_CALLS,
} from './catalogTools.js';
import { createWatcherComponent } from './watcherComponent.js';

/** A recorded watcher reply. */
interface Reply {
  status: number;
  contentType: string;
  retryAfter?: string;
  body: unknown;
}

/** Recorded replies by scenario, from the service's wire fixtures. */
const wire = (file: string): Partial<Record<string, Reply>> =>
  JSON.parse(
    readFileSync(
      new URL(`../../service/src/test/wire/${file}`, import.meta.url),
      'utf8',
    ),
  ) as Partial<Record<string, Reply>>;
const BASELINE = wire('wire-0.20.0.json');
const ERRORS = wire('wire-errors-0.22.0.json');

/** A recorded reply by scenario (the 0.22.0 overlay first). */
const recorded = (scenario: string): Reply => {
  const reply = ERRORS[scenario] ?? BASELINE[scenario];
  if (!reply) throw new Error(`no recorded reply: ${scenario}`);
  return reply;
};

let reply: Reply = recorded('status');
/** What the server received since the last reset: method, URL, headers, body. */
let received: string[] = [];
let server: Server;
let base = '';
let closedBase = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => {
      received.push(
        [
          req.method,
          req.url,
          req.headers.authorization ?? '-',
          req.headers['content-type'] ?? '-',
          data,
        ].join(' '),
      );
      res.writeHead(reply.status, {
        'content-type': reply.contentType,
        ...(reply.retryAfter === undefined
          ? {}
          : { 'retry-after': reply.retryAfter }),
      });
      res.end(
        typeof reply.body === 'string'
          ? reply.body
          : JSON.stringify(reply.body),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  // A port nothing listens on.
  const closed = createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  closedBase = `http://127.0.0.1:${String((closed.address() as AddressInfo).port)}`;
  closed.close();
  await once(closed, 'close');
});

afterAll(() => {
  server.close();
});

/** 0.19.0's tools and the SDK tools for one plugin config. */
function toolsets(pluginConfig: Record<string, unknown>): {
  old: Map<string, ToolDescriptor>;
  sdk: Map<string, ToolDescriptor>;
} {
  const api: PluginApi = { pluginConfig, registerTool: () => undefined };
  const component = createWatcherComponent('0.0.0-test');
  return {
    old: new Map(createCoreToolset(api, component).map((t) => [t.name, t])),
    sdk: createCatalogTools(api, component),
  };
}

/** Run a tool through both paths; both must send the same requests. */
async function both(
  pluginConfig: Record<string, unknown>,
  name: string,
  params: Record<string, unknown>,
): Promise<[ToolResult, ToolResult]> {
  const { old, sdk } = toolsets(pluginConfig);
  received = [];
  const oldResult = await old.get(name)!.execute('old', params);
  const oldRequests = received;
  received = [];
  const sdkResult = await sdk.get(name)!.execute('sdk', params);
  expect(received).toEqual(oldRequests);
  return [oldResult, sdkResult];
}

const config = () => ({ apiUrl: base, apiKey: 'equivalence-key' });

/** [tool, params, success scenario, error scenarios]. */
const CASES: [string, Record<string, unknown>, Reply, string[]][] = [
  ['watcher_status', {}, recorded('status'), ['search masked plain error']],
  ['watcher_config', {}, recorded('config full'), ['config invalid jsonpath']],
  [
    'watcher_config_apply',
    { config: { watch: { paths: ['**/*.md'] } } },
    recorded('configApply patch'),
    ['configApply invalid config'],
  ],
  [
    'watcher_search',
    { query: 'q' },
    recorded('search'),
    [
      'search empty query',
      'search embedding unavailable',
      'search filter rejected',
    ],
  ],
  ['watcher_scan', { filter: {} }, recorded('scan'), ['scan filter rejected']],
  [
    'watcher_show_vcs_file',
    { path: '/r/a.md', commit: 'abc' },
    recorded('vcsShow markdown'),
    ['vcsShow missing file', 'vcsShow without vcs'],
  ],
  [
    'watcher_list_issues',
    {},
    recorded('issues'),
    ['search masked plain error'],
  ],
  [
    'watcher_reindex',
    { scope: 'issues' },
    recorded('reindex issues'),
    ['reindex unknown scope', 'reindex source without queue'],
  ],
  [
    'watcher_set_metadata',
    { path: '/r/a.md', metadata: { k: 1 } },
    recorded('metadata file'),
    ['metadata source not indexed', 'metadata source busy'],
  ],
  [
    'watcher_walk',
    { globs: ['**/*.md'] },
    recorded('walk'),
    ['walk scanning', 'walk no watcher'],
  ],
  [
    'watcher_validate_config',
    {},
    recorded('configValidate current'),
    ['search masked plain error'],
  ],
  [
    'watcher_get_vcs_status',
    {},
    recorded('vcsStatus'),
    ['vcsStatus without vcs'],
  ],
  [
    'watcher_list_vcs_history',
    { glob: '/r/**', limit: '5' },
    recorded('vcsHistory'),
    ['vcsHistory unknown root', 'vcsHistory without vcs'],
  ],
  [
    'watcher_diff_vcs',
    { glob: '/r/a.md', commit: 'abc' },
    recorded('vcsDiff'),
    ['vcsDiff unknown root'],
  ],
  [
    'watcher_check_vcs_exclusion',
    { path: '/r/a.md' },
    recorded('vcsCheckExclusion'),
    ['vcsCheckExclusion unknown root'],
  ],
  [
    'watcher_revert_vcs',
    { glob: '/r/**', commit: 'abc' },
    recorded('vcsRevert'),
    ['vcsRevert unknown root'],
  ],
  [
    'watcher_exclude_vcs_path',
    { glob: '/r/drafts/**' },
    // 0.22.0's reply to an add (D71): the 0.20.0 record minus its departures.
    {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: {
        ok: true,
        file: '{root}/.git/info/exclude',
        action: 'added',
        untracked: 0,
      },
    },
    ['vcsExclude unknown root', 'vcsExclude without vcs'],
  ],
];

describe('SDK tools match 0.19.0 (D205 (3))', () => {
  it('covers every HTTP tool', () => {
    expect(CASES.map(([name]) => name).sort()).toEqual(
      [...SDK_CALLS.keys()].sort(),
    );
  });

  describe.each(CASES)('%s', (name, params, success, errors) => {
    it('returns 0.19.0 text for a success', async () => {
      reply = success;
      const [old, sdk] = await both(config(), name, params);
      expect(old.isError).toBeFalsy();
      expect(sdk).toEqual(old);
    });

    it.each(errors)('returns 0.19.0 text for %s', async (scenario) => {
      reply = recorded(scenario);
      const [old, sdk] = await both(config(), name, params);
      expect(old.isError).toBe(true);
      expect(sdk).toEqual(old);
    });

    it('returns 0.19.0 text when the service is unreachable', async () => {
      const [old, sdk] = await both({ apiUrl: closedBase }, name, params);
      expect(old.isError).toBe(true);
      expect(sdk).toEqual(old);
    });
  });

  it.each([
    [
      'a confirmRequired reply',
      'watcher_exclude_vcs_path',
      { glob: '/r/**' },
      recorded('vcsExclude confirm required'),
    ],
    [
      'a text reply',
      'watcher_show_vcs_file',
      { path: '/r/a.txt', commit: 'abc' },
      recorded('vcsShow text'),
    ],
    [
      'a 401',
      'watcher_search',
      { query: 'q' },
      recorded('unauthorized without key'),
    ],
    [
      'a masked 500 with headers',
      'watcher_search',
      { query: 'q' },
      recorded('search masked status and headers'),
    ],
    [
      'a 3xx reply fetch does not follow',
      'watcher_search',
      { query: 'q' },
      {
        status: 300,
        contentType: 'application/json',
        body: {
          statusCode: 300,
          error: 'Multiple Choices',
          message: 'Pick one.',
        },
      },
    ],
    [
      'a non-Fastify body',
      'watcher_search',
      { query: 'q' },
      {
        status: 502,
        contentType: 'text/html',
        body: '<html>Bad gateway</html>',
      },
    ],
    [
      'a non-Fastify JSON body',
      'watcher_search',
      { query: 'q' },
      {
        status: 502,
        contentType: 'application/json',
        body: { error: 'Bad gateway' },
      },
    ],
    [
      'a Fastify body that is not compact, with an extra field and an escape',
      'watcher_search',
      { query: 'q' },
      {
        status: 503,
        contentType: 'application/json',
        body: '{ "code": "X", "statusCode": 503, "error": "Service Unavailable",\n  "message": "caf\\u00e9", "extra": [1] }',
      },
    ],
    [
      'a JSON body whose error is HTTP <status>',
      'watcher_search',
      { query: 'q' },
      {
        status: 502,
        contentType: 'application/json',
        body: '{"statusCode":502,"error":"HTTP 502","message":"m"}',
      },
    ],
    [
      'a 2xx body that is not JSON',
      'watcher_search',
      { query: 'q' },
      { status: 200, contentType: 'application/json', body: 'not json' },
    ],
  ])('returns 0.19.0 text for %s', async (_label, name, params, answer) => {
    reply = answer;
    const [old, sdk] = await both(config(), name, params);
    expect(sdk).toEqual(old);
  });

  it.each([
    ['watcher_search', {}],
    ['watcher_scan', { filter: 'x' }],
    ['watcher_config_apply', {}],
    ['watcher_set_metadata', { path: 1 }],
  ])('returns 0.19.0 text for invalid input to %s', async (name, params) => {
    reply = recorded('search');
    const [old, sdk] = await both(config(), name, params);
    expect(old.isError).toBe(true);
    expect(sdk).toEqual(old);
  });
});

describe('differences by construction (listed for the owner)', () => {
  it('drops a field the response schema does not declare', async () => {
    reply = {
      status: 200,
      contentType: 'application/json',
      body: { excluded: false, extra: 1 },
    };
    const [old, sdk] = await both(config(), 'watcher_check_vcs_exclusion', {
      path: '/r/a.md',
    });
    expect(old.content[0]?.text).toContain('"extra": 1');
    expect(sdk.content[0]?.text).not.toContain('extra');
  });

  it('prints a reply in the response schema key order', async () => {
    reply = {
      status: 200,
      contentType: 'application/json',
      body: '[{"payload":{"file_path":"a.md"},"score":0.9,"id":"p1"}]',
    };
    const [old, sdk] = await both(config(), 'watcher_search', { query: 'q' });
    const [oldText, sdkText] = [old, sdk].map(
      (result) => result.content[0]?.text,
    );
    expect(oldText).not.toBe(sdkText);
    expect(JSON.parse(sdkText)).toEqual(JSON.parse(oldText));
    expect(Object.keys((JSON.parse(sdkText) as object[])[0])).toEqual([
      'id',
      'score',
      'payload',
    ]);
  });

  it('answers an error for a reply the response schema rejects', async () => {
    reply = {
      status: 200,
      contentType: 'application/json',
      body: [{ bogus: 1 }],
    };
    const [old, sdk] = await both(config(), 'watcher_search', { query: 'q' });
    expect(old.isError).toBeFalsy();
    expect(sdk).toEqual({
      content: [
        {
          type: 'text',
          text: 'Error: search response did not match the expected shape',
        },
      ],
      isError: true,
    });
  });
});
