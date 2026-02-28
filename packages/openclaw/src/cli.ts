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

/** Check if a CLI flag is present in argv. */
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

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

/** Options for config patching. */
export interface PatchConfigOptions {
  /** When true, claim the memory slot for this plugin. */
  memory?: boolean;
}

/** Patch OpenClaw config for install or uninstall. Returns log messages. */
export function patchConfig(
  config: Record<string, unknown>,
  mode: 'add' | 'remove',
  options: PatchConfigOptions = {},
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

  // plugins.slots
  if (!plugins.slots || typeof plugins.slots !== 'object') {
    plugins.slots = {};
  }
  const slots = plugins.slots as Record<string, unknown>;

  if (mode === 'add' && options.memory) {
    // Claim the memory slot when --memory is specified
    slots.memory = PLUGIN_ID;
    messages.push(`Set plugins.slots.memory to "${PLUGIN_ID}"`);
  } else if (mode === 'remove') {
    // Revert the slot on uninstall if we hold it
    if (slots.memory === PLUGIN_ID) {
      slots.memory = 'memory-core';
      messages.push(`Reverted plugins.slots.memory to "memory-core"`);
    }
  }

  // tools.allow
  const tools = (config.tools ?? {}) as Record<string, unknown>;
  const toolAllow = patchAllowList(tools, 'allow', 'tools.allow', mode);
  if (toolAllow) messages.push(toolAllow);

  return messages;
}

/** Install the plugin into OpenClaw's extensions directory. */
function install(): void {
  const memory = hasFlag('--memory');
  const home = resolveOpenClawHome();
  const configPath = resolveConfigPath(home);
  const extDir = join(home, 'extensions', PLUGIN_ID);
  const pkgRoot = getPackageRoot();

  console.log(`OpenClaw home:  ${home}`);
  console.log(`Config:         ${configPath}`);
  console.log(`Extensions dir: ${extDir}`);
  console.log(`Package root:   ${pkgRoot}`);
  console.log(
    `Memory mode:    ${memory ? 'yes (claiming memory slot)' : 'no (watcher tools only)'}`,
  );
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

  // Patch manifest based on --memory flag
  const manifestPath = join(extDir, 'openclaw.plugin.json');
  const manifest = readJson(manifestPath);
  if (manifest) {
    if (memory) {
      manifest.kind = 'memory';
      console.log('  ✓ Set kind: "memory" in manifest');
    } else {
      Reflect.deleteProperty(manifest, 'kind');
      console.log('  ✓ Removed kind from manifest (non-memory mode)');
    }
    writeJson(manifestPath, manifest);
  }

  // Patch config
  console.log();
  console.log('Patching OpenClaw config...');
  const config = readJson(configPath);
  if (!config) {
    console.error(`Error: Could not parse ${configPath}`);
    process.exit(1);
  }

  for (const msg of patchConfig(config, 'add', { memory })) {
    console.log(`  ✓ ${msg}`);
  }
  writeJson(configPath, config);

  console.log();
  console.log('✅ Plugin installed successfully.');
  console.log('   Restart the OpenClaw gateway to load the plugin.');
  if (memory) {
    console.log(
      '   Memory slot claimed — memory_search and memory_get tools will be available.',
    );
  } else {
    console.log(
      '   Watcher tools available. Run with --memory after bootstrapping to enable memory features.',
    );
  }
}

/** Uninstall the plugin from OpenClaw's extensions directory. */
function uninstall(): void {
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

  console.log();
  console.log('✅ Plugin uninstalled successfully.');
  console.log('   Restart the OpenClaw gateway to complete removal.');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'install':
    install();
    break;
  case 'uninstall':
    uninstall();
    break;
  default:
    console.log(
      `@karmaniverous/jeeves-watcher-openclaw — OpenClaw plugin installer`,
    );
    console.log();
    console.log('Usage:');
    console.log(
      '  npx @karmaniverous/jeeves-watcher-openclaw install              Install plugin (watcher tools only)',
    );
    console.log(
      '  npx @karmaniverous/jeeves-watcher-openclaw install --memory     Install with memory slot (replaces memory-core)',
    );
    console.log(
      '  npx @karmaniverous/jeeves-watcher-openclaw uninstall            Remove plugin',
    );
    console.log();
    console.log('Flags:');
    console.log(
      '  --memory   Claim the memory slot, enabling memory_search and memory_get tools.',
    );
    console.log(
      '             Without this flag, the plugin provides only watcher_* tools',
    );
    console.log('             and memory-core remains active.');
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
