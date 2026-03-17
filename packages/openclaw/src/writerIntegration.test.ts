/**
 * @module plugin/writerIntegration.test
 * Integration tests for the ComponentWriter lifecycle via jeeves-core.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createComponentWriter,
  init,
  parseManaged,
  resetInit,
  SOUL_MARKERS,
  TOOLS_MARKERS,
} from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWatcherComponent } from './watcherComponent.js';

// Mock promptInjection so we don't hit the real watcher API.
vi.mock('./promptInjection.js', () => ({
  generateWatcherMenu: vi.fn().mockResolvedValue('Mocked watcher menu'),
}));

describe('jeeves-core integration (watcher plugin)', () => {
  let testDir: string;
  let workspaceDir: string;
  let configDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `jeeves-watcher-openclaw-${String(Date.now())}`);
    workspaceDir = join(testDir, 'workspace');
    configDir = join(testDir, 'config');
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    init({ workspacePath: workspaceDir, configRoot: configDir });
  });

  afterEach(() => {
    resetInit();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes Watcher section as a managed TOOLS.md section and preserves user content', async () => {
    // Platform content probes + lock retries can take several seconds in CI.
    const toolsPath = join(workspaceDir, 'TOOLS.md');
    writeFileSync(toolsPath, 'User notes\n', 'utf-8');

    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:0',
      pluginVersion: '0.7.0',
    });

    const writer = createComponentWriter(component, { probeTimeoutMs: 50 });
    await writer.cycle();

    const toolsContent = readFileSync(toolsPath, 'utf-8');
    const parsed = parseManaged(toolsContent, TOOLS_MARKERS);

    expect(parsed.found).toBe(true);
    expect(parsed.sections.some((s) => s.id === 'Watcher')).toBe(true);
    expect(parsed.sections.some((s) => s.id === 'Platform')).toBe(true);
    // User content outside the managed block is preserved
    expect(parsed.userContent).toContain('User notes');
  }, 30_000);

  it('maintains SOUL.md managed content', async () => {
    const component = createWatcherComponent({
      apiUrl: 'http://127.0.0.1:0',
      pluginVersion: '0.7.0',
    });

    const writer = createComponentWriter(component, { probeTimeoutMs: 50 });
    await writer.cycle();

    const soulPath = join(workspaceDir, 'SOUL.md');
    expect(existsSync(soulPath)).toBe(true);

    const soulParsed = parseManaged(
      readFileSync(soulPath, 'utf-8'),
      SOUL_MARKERS,
    );
    expect(soulParsed.found).toBe(true);
  }, 30_000);
});
