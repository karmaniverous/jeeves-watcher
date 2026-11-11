/**
 * @module api/wireBaseline.test
 * Wire baseline for every catalog route: every scenario in `test/wire/scenarios` is replayed through the real server and must match what jeeves-watcher 0.20.0 sent (`test/wire/wire-0.20.0.json`), apart from the documented changes listed here.
 *
 * Documented changes: every error reply, whose 0.22.0 record is in the
 * overlay `test/wire/wire-errors-0.22.0.json` (spec 0.22.0 Design 5; written
 * by `test/wire/wireErrors.record.ts`, reviewed by hand). Each old
 * `(status, code)` must map to the new one by the code table below, and every
 * overlay error body must parse with jeeves's strict `errorBodySchema`. The
 * overlay also holds the 0.22.0 scenarios (`test/wire/scenarios022`), which
 * have no 0.20.0 record. The approved 0.21.0 departures (`test/wire/departures`)
 * are stripped from the received record (and, for a replaced key, retired
 * from the baseline one) before the comparison.
 */

import { readFileSync } from 'node:fs';

import { errorBodySchema } from '@karmaniverous/jeeves/catalog';
import { SERVER_ERROR_MESSAGE } from '@karmaniverous/jeeves/fastify';
import {
  WATCHER_ERROR_CODES,
  WATCHER_ERROR_STATUS,
} from '@karmaniverous/jeeves-watcher-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { captureLogger, RESPONSE_MISMATCH } from '../test/wire/captureLogger';
import { WIRE_DEPARTURES } from '../test/wire/departures';
import { WIRE_SCENARIOS, type WireRecord } from '../test/wire/scenarios';
import { WIRE_SCENARIOS_022 } from '../test/wire/scenarios022';
import { startWireApp, type WireApp } from '../test/wire/wireApp';
import { runScenario } from '../test/wire/wireRun';
import type * as FileScanModule from './fileScan';

// The wire fixture's watch glob is relative (`**/*.md`), so the prune dry
// run's file listing would walk the working directory (the whole package,
// node_modules included). The wire format does not depend on that listing
// (prunePlan and reindexPrune tests cover it): list no files.
vi.mock('./fileScan', async (importOriginal) => ({
  ...(await importOriginal<typeof FileScanModule>()),
  listFilesFromGlobs: () => Promise.resolve([]),
}));

const read = (file: string) =>
  JSON.parse(
    readFileSync(new URL(`../test/wire/${file}`, import.meta.url), 'utf8'),
  ) as Record<string, WireRecord>;

const baseline = read('wire-0.20.0.json');
const overlay = read('wire-errors-0.22.0.json');

/**
 * The code table (spec 0.22.0 Design 1), as the wire sees it: each 0.20.0
 * `status code` and the 0.22.0 `status code`s it may become. A change the
 * table doesn't explain fails.
 */
const CODE_TABLE: Record<string, readonly string[]> = {
  '400 invalid_request': [
    '400 WATCHER_INVALID_REQUEST',
    '400 FST_ERR_VALIDATION',
    '400 JEEVES_CONFIG_INVALID',
    '400 JEEVES_CONFIG_QUERY_INVALID',
  ],
  '401 unauthorized': ['401 WATCHER_UNAUTHORIZED'],
  '403 path_not_watched': ['403 WATCHER_PATH_NOT_WATCHED'],
  '404 not_found': ['404 WATCHER_NOT_FOUND'],
  '404 source_not_indexed': ['404 WATCHER_SOURCE_NOT_INDEXED'],
  '404 source_not_found': ['404 WATCHER_SOURCE_NOT_FOUND'],
  '422 unsupported_content_type': ['422 WATCHER_UNSUPPORTED_CONTENT_TYPE'],
  '422 pipeline_error': WATCHER_ERROR_CODES.filter((c) =>
    c.startsWith('WATCHER_PIPELINE_'),
  ).map((c) => `422 ${c}`),
  '502 source_unavailable': ['502 WATCHER_SOURCE_UNAVAILABLE'],
  '503 not_available': ['503 WATCHER_NOT_AVAILABLE'],
  '503 scan_in_progress': ['503 WATCHER_SCAN_IN_PROGRESS'],
  '503 embedding_unavailable': ['503 WATCHER_EMBEDDING_UNAVAILABLE'],
  '409 confirm_required': ['200 confirmRequired'],
  '500 internal_error': ['500 (no code)'],
};

/** `status code` of a record (`(no code)` for a body without one). */
function statusCode(record: WireRecord): string {
  const body = record.body as Record<string, unknown>;
  if (body.confirmRequired === true)
    return `${String(record.status)} confirmRequired`;
  const code = typeof body.code === 'string' ? body.code : '(no code)';
  return `${String(record.status)} ${code}`;
}

let wire: WireApp;
const captured = captureLogger();

beforeAll(async () => {
  wire = await startWireApp(captured.logger);
}, 30_000);

afterAll(async () => {
  await wire.close();
});

describe('catalog routes keep the 0.20.0 wire format', () => {
  it('has a baseline for every scenario and no stale ones', () => {
    expect(Object.keys(baseline).sort()).toEqual(
      WIRE_SCENARIOS.map((s) => s.name).sort(),
    );
  });

  it('documents departures only for known scenarios', () => {
    for (const name of Object.keys(WIRE_DEPARTURES)) {
      expect(baseline).toHaveProperty([name]);
    }
  });

  it.each(WIRE_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s',
    async (name, scenario) => {
      const expected = overlay[name] ?? baseline[name];
      const received = await runScenario(wire, scenario);
      const departure = WIRE_DEPARTURES[name];
      const { record, stripped } = departure?.strip(received) ?? {
        record: received,
        stripped: 1,
      };
      // A departure that strips nothing no longer happens: remove it.
      expect({ name, departureApplies: stripped > 0 }).toEqual({
        name,
        departureApplies: true,
      });
      expect(record).toEqual(departure?.retire?.(expected) ?? expected);
    },
  );
});

describe('the 0.22.0 error overlay', () => {
  it('holds every 0.20.0 error scenario and every 0.22.0 scenario, nothing else', () => {
    const errors = Object.entries(baseline)
      .filter(([, record]) => record.status >= 400)
      .map(([name]) => name);
    expect(Object.keys(overlay).sort()).toEqual(
      [...errors, ...WIRE_SCENARIOS_022.map((s) => s.name)].sort(),
    );
  });

  it.each(Object.entries(baseline).filter(([name]) => name in overlay))(
    '%s changes by the code table',
    (name, before) => {
      const after = overlay[name];
      expect({ name, allowed: CODE_TABLE[statusCode(before)] }).toEqual({
        name,
        allowed: expect.arrayContaining([statusCode(after)]) as unknown,
      });
    },
  );

  it.each(Object.entries(overlay).filter(([, record]) => record.status >= 400))(
    '%s is a strict standard error body',
    (_name, record) => {
      const parsed = errorBodySchema.strict().safeParse(record.body);
      expect(parsed.error?.issues).toBeUndefined();
      const { code, statusCode: bodyStatus } = record.body as {
        code?: string;
        statusCode: number;
      };
      expect(bodyStatus).toBe(record.status);
      const documented = code?.startsWith('WATCHER_')
        ? WATCHER_ERROR_STATUS[code as keyof typeof WATCHER_ERROR_STATUS]
        : record.status;
      expect(record.status).toBe(documented);
    },
  );

  it('covers every WATCHER_* code', () => {
    const codes = new Set(
      Object.values(overlay).map(
        (record) => (record.body as { code?: string }).code,
      ),
    );
    expect(WATCHER_ERROR_CODES.filter((c) => !codes.has(c))).toEqual([]);
  });

  it('sends no Cache-Control on an error', () => {
    const cached = Object.entries(overlay).filter(
      ([, record]) => record.status >= 400 && record.cacheControl !== undefined,
    );
    expect(cached).toEqual([]);
  });
});

describe('0.22.0 scenarios', () => {
  it.each(WIRE_SCENARIOS_022.map((s) => [s.name, s] as const))(
    '%s',
    async (name, scenario) => {
      expect(await runScenario(wire, scenario)).toEqual(overlay[name]);
    },
  );

  it('answers an unknown route and a gated route alike', () => {
    const unknown = overlay['unknown route'];
    const gated = overlay['gated route'];
    const norm = (record: WireRecord) => ({
      ...record,
      body: {
        ...(record.body as object),
        message: (record.body as { message: string }).message.replace(
          /^Route GET:\/vcs\/\w+/,
          'Route GET:/vcs/X',
        ),
      },
    });
    expect(norm(gated)).toEqual(norm(unknown));
  });

  it('masks each unmapped error as a bare 500 and logs it once', async () => {
    for (const name of [
      'search masked plain error',
      'search masked qdrant error',
      'search masked status and headers',
    ]) {
      const before = captured.records.length;
      const record = await runScenario(
        wire,
        WIRE_SCENARIOS_022.find((s) => s.name === name)!,
      );
      expect(record).toEqual({
        status: 500,
        contentType: 'application/json; charset=utf-8',
        body: {
          statusCode: 500,
          error: 'Internal Server Error',
          message: SERVER_ERROR_MESSAGE,
        },
      });
      const logged = captured.records
        .slice(before)
        .filter((r) => r.level >= 50);
      expect({ name, logged: logged.length }).toEqual({ name, logged: 1 });
    }
  });
});

describe('catalog response validation', () => {
  it('logs no response mismatch across every scenario', () => {
    const mismatches = captured.records.filter((r) =>
      r.msg.startsWith(RESPONSE_MISMATCH),
    );
    expect(mismatches).toEqual([]);
  });
});
