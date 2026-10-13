/**
 * @module test/cliCommands
 * Shared fetch mock and helpers for the custom CLI command suites (cli/jeeves-watcher/customCommands*.test.ts): a CLI with the commands registered, canned JSON responses and first-request inspection. No I/O.
 */

import { Command } from '@commander-js/extra-typings';
import { vi } from 'vitest';

import { registerCustomCommands } from '../cli/jeeves-watcher/customCommands';

/** The fetch mock the suites install as `global.fetch`. */
export const mockFetch = vi.fn();

/**
 * A fresh CLI with the custom commands registered (throws instead of exiting).
 *
 * @returns The CLI.
 */
export function makeCli(): Command {
  const cli = new Command().exitOverride();
  registerCustomCommands(cli);
  return cli;
}

/**
 * Make the next fetch calls answer 200 with `data` as JSON.
 *
 * @param data - Response body.
 */
export function mockJsonResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

/**
 * URL of the first fetch call.
 *
 * @returns The URL, or an empty string.
 */
export function getFirstCallUrl(): string {
  const calls = mockFetch.mock.calls as unknown[][];
  const first = calls.at(0);
  if (!first) return '';
  const url = first[0];
  return typeof url === 'string' ? url : '';
}

/**
 * Body of the first fetch call.
 *
 * @returns The body string, or an empty string.
 */
export function getFirstRequestBody(): string {
  const calls = mockFetch.mock.calls as unknown[][];
  const firstCall = calls.at(0);
  if (!firstCall) return '';
  const init = firstCall[1];
  if (typeof init !== 'object' || init === null || !('body' in init)) return '';
  const body = (init as { body?: unknown }).body;
  return typeof body === 'string' ? body : '';
}
