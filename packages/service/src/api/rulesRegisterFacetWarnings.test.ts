/**
 * @module api/rulesRegisterFacetWarnings.test
 * `POST /rules/register` logs an unknown uiHint of the registered rules once (spec D206 (3)), through the server's real wiring, and still answers 200.
 */

import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startWireApp, WIRE_AUTH, type WireApp } from '../test/wire/wireApp';

describe('POST /rules/register facet warnings', () => {
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  let wire: WireApp;

  beforeAll(async () => {
    wire = await startWireApp(logger);
  });
  afterAll(async () => {
    await wire.close();
  });

  /** Register one rule whose schema declares the given properties. */
  async function register(
    name: string,
    properties: Record<string, Record<string, unknown>>,
  ) {
    warn.mockClear();
    const res = await wire.app.inject({
      method: 'POST',
      url: '/rules/register',
      headers: WIRE_AUTH,
      payload: {
        source: 'facets-test',
        rules: [
          { name, description: name, match: {}, schema: [{ properties }] },
        ],
      },
    });
    return {
      status: res.statusCode,
      warned: warn.mock.calls.map((c) => c[0] as Record<string, unknown>),
    };
  }

  it('warns once naming rule, property and hint, and still registers', async () => {
    const { status, warned } = await register('odd', {
      kind: { type: 'string', uiHint: 'selct' },
      tag: { type: 'string', uiHint: 'tags' },
    });
    expect(status).toBe(200);
    expect(warned).toEqual([
      expect.objectContaining({
        rule: 'odd',
        property: 'kind',
        uiHint: 'selct',
      }),
    ]);
  });

  it('is silent for known hints', async () => {
    const { status, warned } = await register('fine', {
      kind: { type: 'string', uiHint: 'select' },
    });
    expect(status).toBe(200);
    expect(warned).toEqual([]);
  });
});
