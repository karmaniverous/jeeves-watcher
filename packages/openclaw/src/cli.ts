/**
 * CLI for installing/uninstalling the jeeves-watcher OpenClaw plugin.
 *
 * Usage:
 *   npx @karmaniverous/jeeves-watcher-openclaw install
 *   npx @karmaniverous/jeeves-watcher-openclaw uninstall
 *
 * Bypasses OpenClaw's `plugins install` command, which has a known
 * spawn EINVAL bug on Windows (https://github.com/openclaw/openclaw/issues/9224).
 *
 * Supports non-default installations via:
 *   - OPENCLAW_CONFIG env var (path to openclaw.json)
 *   - OPENCLAW_HOME env var (path to .openclaw directory)
 *   - Default: ~/.openclaw/openclaw.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const PLUGIN_ID = 'jeeves-watcher-openclaw';

/** Resolve the OpenClaw home directory. */
function resolveOpenClawHome(): string {
  // 1. OPENCLAW_CONFIG points directly to the config file
  if (process.env.OPENCLAW_CONFIG) {
    return dirname(resolve(process.env.OPENCLAW_CONFIG));
  }

  // 2. OPENCLAW_HOME points to the .openclaw directory
  if (process.env.OPENCLAW_HOME) {
    return resolve(process.env.OPENCLAW_HOME);
  }

  // 3. Default location
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
  // In dist: dist/cli.js → package root is ..
  // In src: src/cli.ts → package root is ..
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

  // Validate OpenClaw home exists
  if (!existsSync(home)) {
    console.error(`Error: OpenClaw home directory not found at ${home}`);
    console.error('Set OPENCLAW_HOME or OPENCLAW_CONFIG if using a non-default installation.');
    process.exit(1);
  }

  // Validate config exists
  if (!existsSync(configPath)) {
    console.error(`Error: OpenClaw config not found at ${configPath}`);
    console.error('Set OPENCLAW_CONFIG if using a non-default config location.');
    process.exit(1);
  }

  // Validate package root has openclaw.plugin.json
  const pluginManifestPath = join(pkgRoot, 'openclaw.plugin.json');
  if (!existsSync(pluginManifestPath)) {
    console.error(`Error: openclaw.plugin.json not found at ${pluginManifestPath}`);
    process.exit(1);
  }

  // Copy package to extensions directory
  console.log('Copying plugin to extensions directory...');
  if (existsSync(extDir)) {
    rmSync(extDir, { recursive: true, force: true });
  }
  mkdirSync(extDir, { recursive: true });

  // Copy dist/, openclaw.plugin.json, package.json
  const filesToCopy = ['dist', 'openclaw.plugin.json', 'package.json'];
  for (const file of filesToCopy) {
    const src = join(pkgRoot, file);
    const dest = join(extDir, file);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
      console.log(`  ✓ ${file}`);
    }
  }

  // Copy node_modules if present (for runtime dependencies)
  const nodeModulesSrc = join(pkgRoot, 'node_modules');
  if (existsSync(nodeModulesSrc)) {
    cpSync(nodeModulesSrc, join(extDir, 'node_modules'), { recursive: true });
    console.log('  ✓ node_modules');
  }

  // Patch OpenClaw config
  console.log();
  console.log('Patching OpenClaw config...');
  const config = readJson(configPath);
  if (!config) {
    console.error(`Error: Could not parse ${configPath}`);
    process.exit(1);
  }

  // Ensure plugins section exists
  if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
  }
  const plugins = config.plugins as Record<string, unknown>;

  // Add to plugins.allow
  if (!Array.isArray(plugins.allow)) {
    plugins.allow = [];
  }
  const allow = plugins.allow as string[];
  if (!allow.includes(PLUGIN_ID)) {
    allow.push(PLUGIN_ID);
    console.log(`  ✓ Added "${PLUGIN_ID}" to plugins.allow`);
  }

  // Add to plugins.entries
  if (!plugins.entries || typeof plugins.entries !== 'object') {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;
  if (!entries[PLUGIN_ID]) {
    entries[PLUGIN_ID] = { enabled: true };
    console.log(`  ✓ Added "${PLUGIN_ID}" to plugins.entries`);
  }

  // Ensure tools.allow includes the plugin
  if (!config.tools || typeof config.tools !== 'object') {
    config.tools = {};
  }
  const tools = config.tools as Record<string, unknown>;
  if (!Array.isArray(tools.allow)) {
    tools.allow = [];
  }
  const toolsAllow = tools.allow as string[];
  if (!toolsAllow.includes(PLUGIN_ID)) {
    toolsAllow.push(PLUGIN_ID);
    console.log(`  ✓ Added "${PLUGIN_ID}" to tools.allow`);
  }

  writeJson(configPath, config);

  console.log();
  console.log('✅ Plugin installed successfully.');
  console.log('   Restart the OpenClaw gateway to load the plugin.');
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

  // Remove extensions directory
  if (existsSync(extDir)) {
    rmSync(extDir, { recursive: true, force: true });
    console.log(`✓ Removed ${extDir}`);
  } else {
    console.log(`  (extensions directory not found, skipping)`);
  }

  // Patch OpenClaw config
  if (existsSync(configPath)) {
    console.log('Patching OpenClaw config...');
    const config = readJson(configPath);
    if (config) {
      const plugins = (config.plugins ?? {}) as Record<string, unknown>;

      // Remove from plugins.allow
      if (Array.isArray(plugins.allow)) {
        plugins.allow = (plugins.allow as string[]).filter((id) => id !== PLUGIN_ID);
        console.log(`  ✓ Removed "${PLUGIN_ID}" from plugins.allow`);
      }

      // Remove from plugins.entries
      if (plugins.entries && typeof plugins.entries === 'object') {
        const entries = plugins.entries as Record<string, unknown>;
        if (PLUGIN_ID in entries) {
          delete entries[PLUGIN_ID];
          console.log(`  ✓ Removed "${PLUGIN_ID}" from plugins.entries`);
        }
      }

      // Remove from tools.allow
      const tools = (config.tools ?? {}) as Record<string, unknown>;
      if (Array.isArray(tools.allow)) {
        tools.allow = (tools.allow as string[]).filter((id) => id !== PLUGIN_ID);
        console.log(`  ✓ Removed "${PLUGIN_ID}" from tools.allow`);
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
    console.log(`@karmaniverous/jeeves-watcher-openclaw — OpenClaw plugin installer`);
    console.log();
    console.log('Usage:');
    console.log('  npx @karmaniverous/jeeves-watcher-openclaw install    Install plugin');
    console.log('  npx @karmaniverous/jeeves-watcher-openclaw uninstall  Remove plugin');
    console.log();
    console.log('Environment variables:');
    console.log('  OPENCLAW_CONFIG  Path to openclaw.json (overrides all)');
    console.log('  OPENCLAW_HOME    Path to .openclaw directory');
    console.log();
    console.log('Default: ~/.openclaw/openclaw.json');
    if (command && command !== 'help' && command !== '--help' && command !== '-h') {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
    break;
}
