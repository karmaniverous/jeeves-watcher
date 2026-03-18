/**
 * CLI for installing/uninstalling the jeeves-watcher OpenClaw plugin.
 *
 * Usage:
 *   npx \@karmaniverous/jeeves-watcher-openclaw install
 *   npx \@karmaniverous/jeeves-watcher-openclaw uninstall
 *
 * Bypasses OpenClaw's `plugins install` command, which has a known
 * spawn EINVAL bug on Windows (https://github.com/openclaw/openclaw/issues/9224).
 *
 * Supports non-default installations via:
 *   - OPENCLAW_CONFIG env var (path to openclaw.json)
 *   - OPENCLAW_HOME env var (path to .openclaw directory)
 *   - Default: ~/.openclaw/openclaw.json
 */

import {
  parseManaged,
  TOOLS_MARKERS,
  updateManagedSection,
} from '@karmaniverous/jeeves';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PLUGIN_ID = 'jeeves-watcher-openclaw';

/** Resolve the OpenClaw home directory. */
function resolveOpenClawHome(): string {
  if (process.env.OPENCLAW_CONFIG) {
    return dirname(resolve(process.env.OPENCLAW_CONFIG));
  }
  if (process.env.OPENCLAW_HOME) {
    return resolve(process.env.OPENCLAW_HOME);
  }
  return join(homedir(), '.openclaw');
}

/** Resolve the config file path. */
function resolveConfigPath(home: string): string {
  if (process.env.OPENCLAW_CONFIG) {
    return resolve(process.env.OPENCLAW_CONFIG);
  }
  return join(home, 'openclaw.json');
}

/** Get the package root (where this CLI lives). */
function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), '..');
}

/** Read and parse JSON, returning null on failure. */
function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Write JSON with 2-space indent + trailing newline. */
function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Patch an allowlist array: add or remove the plugin ID.
 * Returns a log message if a change was made, or undefined.
 */
function patchAllowList(
  parent: Record<string, unknown>,
  key: string,
  label: string,
  mode: 'add' | 'remove',
): string | undefined {
  if (!Array.isArray(parent[key]) || (parent[key] as unknown[]).length === 0)
    return undefined;

  const list = parent[key] as string[];
  if (mode === 'add') {
    if (!list.includes(PLUGIN_ID)) {
      list.push(PLUGIN_ID);
      return `Added "${PLUGIN_ID}" to ${label}`;
    }
  } else {
    const filtered = list.filter((id) => id !== PLUGIN_ID);
    if (filtered.length !== list.length) {
      parent[key] = filtered;
      return `Removed "${PLUGIN_ID}" from ${label}`;
    }
  }
  return undefined;
}

/** Patch OpenClaw config for install or uninstall. Returns log messages. */
export function patchConfig(
  config: Record<string, unknown>,
  mode: 'add' | 'remove',
): string[] {
  const messages: string[] = [];

  // Ensure plugins section
  if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
  }
  const plugins = config.plugins as Record<string, unknown>;

  // plugins.allow
  const pluginAllow = patchAllowList(plugins, 'allow', 'plugins.allow', mode);
  if (pluginAllow) messages.push(pluginAllow);

  // plugins.entries
  if (!plugins.entries || typeof plugins.entries !== 'object') {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;
  if (mode === 'add') {
    if (!entries[PLUGIN_ID]) {
      entries[PLUGIN_ID] = { enabled: true };
      messages.push(`Added "${PLUGIN_ID}" to plugins.entries`);
    }
  } else if (PLUGIN_ID in entries) {
    Reflect.deleteProperty(entries, PLUGIN_ID);
    messages.push(`Removed "${PLUGIN_ID}" from plugins.entries`);
  }

  // tools.allow
  const tools = (config.tools ?? {}) as Record<string, unknown>;
  const toolAllow = patchAllowList(tools, 'allow', 'tools.allow', mode);
  if (toolAllow) messages.push(toolAllow);

  return messages;
}

/** Install the plugin into OpenClaw's extensions directory. */
function install(): void {
  const home = resolveOpenClawHome();
  const configPath = resolveConfigPath(home);
  const extDir = join(home, 'extensions', PLUGIN_ID);
  const pkgRoot = getPackageRoot();

  console.log(`OpenClaw home:  ${home}`);
  console.log(`Config:         ${configPath}`);
  console.log(`Extensions dir: ${extDir}`);
  console.log(`Package root:   ${pkgRoot}`);
  console.log();

  if (!existsSync(home)) {
    console.error(`Error: OpenClaw home directory not found at ${home}`);
    console.error(
      'Set OPENCLAW_HOME or OPENCLAW_CONFIG if using a non-default installation.',
    );
    process.exit(1);
  }

  if (!existsSync(configPath)) {
    console.error(`Error: OpenClaw config not found at ${configPath}`);
    console.error(
      'Set OPENCLAW_CONFIG if using a non-default config location.',
    );
    process.exit(1);
  }

  const pluginManifestPath = join(pkgRoot, 'openclaw.plugin.json');
  if (!existsSync(pluginManifestPath)) {
    console.error(
      `Error: openclaw.plugin.json not found at ${pluginManifestPath}`,
    );
    process.exit(1);
  }

  // Copy package to extensions directory
  console.log('Copying plugin to extensions directory...');
  if (existsSync(extDir)) {
    rmSync(extDir, { recursive: true, force: true });
  }
  mkdirSync(extDir, { recursive: true });

  for (const file of ['dist', 'openclaw.plugin.json', 'package.json']) {
    const src = join(pkgRoot, file);
    const dest = join(extDir, file);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
      console.log(`  ✓ ${file}`);
    }
  }

  const nodeModulesSrc = join(pkgRoot, 'node_modules');
  if (existsSync(nodeModulesSrc)) {
    cpSync(nodeModulesSrc, join(extDir, 'node_modules'), { recursive: true });
    console.log('  ✓ node_modules');
  }

  // Patch config
  console.log();
  console.log('Patching OpenClaw config...');
  const config = readJson(configPath);
  if (!config) {
    console.error(`Error: Could not parse ${configPath}`);
    process.exit(1);
  }

  for (const msg of patchConfig(config, 'add')) {
    console.log(`  ✓ ${msg}`);
  }
  writeJson(configPath, config);

  console.log();
  console.log('✅ Plugin installed successfully.');
  console.log('   Restart the OpenClaw gateway to load the plugin.');
}

/** Uninstall the plugin from OpenClaw's extensions directory. */
async function uninstall(): Promise<void> {
  const home = resolveOpenClawHome();
  const configPath = resolveConfigPath(home);
  const extDir = join(home, 'extensions', PLUGIN_ID);

  console.log(`OpenClaw home:  ${home}`);
  console.log(`Config:         ${configPath}`);
  console.log(`Extensions dir: ${extDir}`);
  console.log();

  if (existsSync(extDir)) {
    rmSync(extDir, { recursive: true, force: true });
    console.log(`✓ Removed ${extDir}`);
  } else {
    console.log(`  (extensions directory not found, skipping)`);
  }

  if (existsSync(configPath)) {
    console.log('Patching OpenClaw config...');
    const config = readJson(configPath);
    if (config) {
      for (const msg of patchConfig(config, 'remove')) {
        console.log(`  ✓ ${msg}`);
      }
      writeJson(configPath, config);
    }
  }

  // Clean up TOOLS.md watcher section
  await cleanupToolsMd(home, configPath);

  console.log();
  console.log('✅ Plugin uninstalled successfully.');
  console.log('   Restart the OpenClaw gateway to complete removal.');
}

/** Resolve the workspace directory from OpenClaw config. */
function resolveWorkspaceDir(home: string, configPath: string): string | null {
  const config = readJson(configPath);
  if (!config) return null;

  // Check agents.defaults.workspace
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const workspace = defaults?.workspace as string | undefined;
  if (workspace) {
    return resolve(workspace.replace(/^~/, homedir()));
  }

  // Default workspace location
  return join(home, 'workspace');
}

/**
 * Remove the Watcher section from TOOLS.md on uninstall.
 *
 * @remarks
 * Uses core's `parseManaged` to locate the managed block and its sections,
 * then rewrites without the Watcher section via `updateManagedSection`.
 * If the Watcher section is the only one, removes the entire managed block.
 */
async function cleanupToolsMd(home: string, configPath: string): Promise<void> {
  const workspaceDir = resolveWorkspaceDir(home, configPath);
  if (!workspaceDir) return;

  const toolsPath = join(workspaceDir, 'TOOLS.md');
  if (!existsSync(toolsPath)) return;

  const content = readFileSync(toolsPath, 'utf8');
  const parsed = parseManaged(content, TOOLS_MARKERS);

  if (!parsed.found) return;

  const watcherSection = parsed.sections.find((s) => s.id === 'Watcher');
  if (!watcherSection) return;

  const remaining = parsed.sections.filter((s) => s.id !== 'Watcher');

  if (remaining.length === 0) {
    // No sections left — remove the entire managed block.
    const parts: string[] = [];
    if (parsed.beforeContent) parts.push(parsed.beforeContent);
    if (parsed.userContent) {
      if (parts.length > 0) parts.push('');
      parts.push(parsed.userContent);
    }
    const newContent = parts.join('\n').trim() + '\n';
    writeFileSync(toolsPath, newContent);
  } else {
    // Rewrite the managed block without the Watcher section.
    // We write an empty string for the Watcher section; core's
    // updateManagedSection will rebuild from the remaining sections.
    // Actually, the cleanest approach is to rebuild the section text
    // from the remaining sections and write the entire block.
    const sectionText = remaining
      .map((s) => `## ${s.id}\n\n${s.content}`)
      .join('\n\n');

    const body = `# ${TOOLS_MARKERS.title}\n\n${sectionText}`;

    await updateManagedSection(toolsPath, body, {
      mode: 'block',
      markers: TOOLS_MARKERS,
    });
  }

  console.log('\u2713 Cleaned up TOOLS.md (removed Watcher section)');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'install':
    install();
    break;
  case 'uninstall':
    void uninstall();
    break;
  default:
    console.log(
      `@karmaniverous/jeeves-watcher-openclaw — OpenClaw plugin installer`,
    );
    console.log();
    console.log('Usage:');
    console.log(
      '  npx @karmaniverous/jeeves-watcher-openclaw install    Install plugin',
    );
    console.log(
      '  npx @karmaniverous/jeeves-watcher-openclaw uninstall  Remove plugin',
    );
    console.log();
    console.log('Environment variables:');
    console.log('  OPENCLAW_CONFIG  Path to openclaw.json (overrides all)');
    console.log('  OPENCLAW_HOME    Path to .openclaw directory');
    console.log();
    console.log('Default: ~/.openclaw/openclaw.json');
    if (
      command &&
      command !== 'help' &&
      command !== '--help' &&
      command !== '-h'
    ) {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
    break;
}
