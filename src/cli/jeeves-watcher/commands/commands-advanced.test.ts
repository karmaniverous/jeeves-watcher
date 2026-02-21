/**
 * @module commands/commands-advanced.test
 *
 * Tests for advanced CLI commands (configReindex, rebuildMetadata, service).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigReindexCommand } from './configReindex';
import { registerRebuildMetadataCommand } from './rebuildMetadata';
import { registerServiceCommand } from './service';

// Mock console methods
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let processExitSpy: ReturnType<typeof vi.spyOn>;

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  processExitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  mockFetch.mockClear();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  consoleLogSpy.mockRestore();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  consoleErrorSpy.mockRestore();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  processExitSpy.mockRestore();
});

describe('configReindex command', () => {
  it('validates scope parameter - rules', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerConfigReindexCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/require-await
      text: async () => 'Config reindex started',
    });

    await cli.parseAsync([
      'node',
      'test',
      'config-reindex',
      '--scope',
      'rules',
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/config-reindex',
      expect.objectContaining({
        body: JSON.stringify({ scope: 'rules' }),
      }),
    );
  });

  it('validates scope parameter - full', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerConfigReindexCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/require-await
      text: async () => 'Full reindex started',
    });

    await cli.parseAsync(['node', 'test', 'config-reindex', '--scope', 'full']);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ scope: 'full' }),
      }),
    );
  });

  it('rejects invalid scope', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerConfigReindexCommand(cli);

    await cli.parseAsync([
      'node',
      'test',
      'config-reindex',
      '--scope',
      'invalid',
    ]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid scope. Must be "rules" or "full"',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('uses default scope of rules', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerConfigReindexCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/require-await
      text: async () => 'OK',
    });

    await cli.parseAsync(['node', 'test', 'config-reindex']);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ scope: 'rules' }),
      }),
    );
  });
});

describe('rebuildMetadata command', () => {
  it('calls POST /rebuild-metadata', async () => {
    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerRebuildMetadataCommand(cli);

    mockFetch.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/require-await
      text: async () => 'Metadata rebuild started',
    });

    await cli.parseAsync(['node', 'test', 'rebuild-metadata']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/rebuild-metadata',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Metadata rebuild started');
  });
});

describe('service command', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('generates Windows NSSM install instructions', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerServiceCommand(cli);

    await cli.parseAsync(['node', 'test', 'service', 'install']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('NSSM install'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('nssm install jeeves-watcher'),
    );
  });

  it('generates systemd install instructions on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerServiceCommand(cli);

    await cli.parseAsync(['node', 'test', 'service', 'install']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Unit]'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('systemd unit file'),
    );
  });

  it('includes config path in install instructions', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerServiceCommand(cli);

    await cli.parseAsync([
      'node',
      'test',
      'service',
      'install',
      '--config',
      '/path/to/config.json',
    ]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('--config "/path/to/config.json"'),
    );
  });

  it('generates uninstall instructions for Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerServiceCommand(cli);

    await cli.parseAsync(['node', 'test', 'service', 'uninstall']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('nssm stop'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('nssm remove'),
    );
  });

  it('generates uninstall instructions for Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const { Command } = await import('@commander-js/extra-typings');
    const cli = new Command();
    registerServiceCommand(cli);

    await cli.parseAsync(['node', 'test', 'service', 'uninstall']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('systemctl --user disable'),
    );
  });
});
