/**
 * @module plugin/toolBaseline.test
 * Agent-facing surface baseline: every registered tool's name, description, parameters, `catalogMode` and registration options, and the injected prompt rules, must match what plugin 0.17.0 registered (`test/baseline-0.17.0/`), apart from the documented changes listed here.
 */

import { readFileSync } from 'node:fs';

import type {
  PluginApi,
  PromptBuildHandler,
  ToolDescriptor,
  ToolRegistrationOptions,
} from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import register from './index.js';

/** The agent-facing part of a registered tool. */
interface ToolSurface {
  name: string;
  description: string;
  parameters: unknown;
  catalogMode?: string;
  options?: ToolRegistrationOptions;
}

const fixture = (file: string) =>
  readFileSync(
    new URL(`./test/baseline-0.17.0/${file}`, import.meta.url),
    'utf8',
  );

const baselineTools = JSON.parse(fixture('tools.json')) as ToolSurface[];
const baselineRules = fixture('promptRules.md');

/** Add `additionalProperties: false` to an object parameter schema. */
const closed = (before: ToolSurface): ToolSurface => ({
  ...before,
  parameters: {
    ...(before.parameters as Record<string, unknown>),
    additionalProperties: false,
  },
});

/** Zod's JSON Schema for an open record (`z.record(z.string(), z.unknown())`). */
const OPEN_RECORD = {
  additionalProperties: {},
  propertyNames: { type: 'string' },
};

/** JSON Schema for a non-negative / positive safe integer. */
const MAX_SAFE = { type: 'integer', maximum: Number.MAX_SAFE_INTEGER };

/**
 * Close the parameter schema, then merge `fields` into its properties (each
 * merged over the baseline property, so names and descriptions are kept).
 */
const catalogBuilt =
  (fields: Record<string, Record<string, unknown>> = {}) =>
  (before: ToolSurface): ToolSurface => {
    const params = closed(before).parameters as {
      properties: Record<string, Record<string, unknown>>;
    };
    const properties = { ...params.properties };
    for (const [key, patch] of Object.entries(fields))
      properties[key] = { ...properties[key], ...patch };
    return { ...before, parameters: { ...params, properties } };
  };

/**
 * Documented changes, keyed by tool name: the expected surface replaces the
 * baseline one. Every catalog-built tool's parameters are generated from its
 * entry's request schema (spec #281 design 7): closed objects, open records
 * for filters and patches, and the bounds the server already enforced.
 * Names, descriptions and `catalogMode` are unchanged.
 */
const CHANGES: Partial<Record<string, (before: ToolSurface) => ToolSurface>> = {
  watcher_status: catalogBuilt(),
  watcher_config: catalogBuilt(),
  watcher_config_apply: (before) => {
    const after = catalogBuilt({ config: OPEN_RECORD })(before);
    const params = after.parameters as {
      properties: Record<string, unknown>;
    };
    // jeeves 0.8.0: the standard config-apply tool gains `replace`.
    return {
      ...after,
      parameters: {
        ...params,
        properties: {
          ...params.properties,
          replace: {
            type: 'boolean',
            description: 'Replace the whole config instead of merging',
          },
        },
      },
    };
  },
  watcher_search: catalogBuilt({
    query: { minLength: 1 },
    limit: { ...MAX_SAFE, exclusiveMinimum: 0 },
    offset: { ...MAX_SAFE, minimum: 0 },
    filter: OPEN_RECORD,
  }),
  watcher_scan: catalogBuilt({
    filter: OPEN_RECORD,
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    // Qdrant point ids (and so cursors) are strings or numbers.
    cursor: { type: ['string', 'number'] },
  }),
  watcher_vcs_show: catalogBuilt({
    path: { minLength: 1 },
    commit: { minLength: 1 },
  }),
};

/** Register the plugin against a capturing API. */
function capture(): { tools: ToolSurface[]; hooks: [string, unknown][] } {
  const tools: ToolSurface[] = [];
  const hooks: [string, unknown][] = [];
  const api: PluginApi = {
    registerTool: (tool: ToolDescriptor, options?: ToolRegistrationOptions) => {
      const { catalogMode } = tool as ToolDescriptor & { catalogMode?: string };
      tools.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(catalogMode ? { catalogMode } : {}),
        ...(options ? { options } : {}),
      });
    },
    on: (name: string, handler: unknown) => {
      hooks.push([name, handler]);
    },
    logger: { warn: () => undefined },
  };
  register(api);
  return { tools, hooks };
}

describe('plugin surface keeps the 0.17.0 baseline', () => {
  const { tools, hooks } = capture();

  it('registers the same tool names in the same order', () => {
    expect(tools.map((t) => t.name)).toEqual(baselineTools.map((t) => t.name));
  });

  it.each(baselineTools.map((t) => [t.name, t] as const))(
    '%s',
    (name, before) => {
      const expected = CHANGES[name]?.(before) ?? before;
      expect(tools.find((t) => t.name === name)).toEqual(expected);
    },
  );

  it('injects the 0.17.0 prompt rules byte for byte', async () => {
    const hook = hooks.find(([name]) => name === 'before_prompt_build');
    const handler = hook?.[1] as PromptBuildHandler;
    const result = (await handler({ prompt: '', messages: [] }, {})) as {
      appendSystemContext?: string;
    };
    expect(result.appendSystemContext).toBe(baselineRules);
  });
});
