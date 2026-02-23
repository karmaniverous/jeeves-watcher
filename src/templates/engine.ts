/**
 * @module templates/engine
 * Handlebars template compilation, caching, and resolution (file path vs named ref vs inline).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Handlebars from 'handlebars';

import { registerBuiltinHelpers } from './helpers';

/** A compiled Handlebars template function. */
export type CompiledTemplate = HandlebarsTemplateDelegate;

/**
 * Resolve a template value to its source string.
 *
 * Resolution order:
 * 1. Ends in `.hbs` or `.handlebars` → file path (resolve relative to configDir)
 * 2. Matches a key in namedTemplates → named ref (recursively resolve)
 * 3. Otherwise → inline Handlebars template string
 *
 * @param value - The template reference (inline, file path, or named ref).
 * @param namedTemplates - Named template definitions from config.
 * @param configDir - Directory to resolve relative file paths against.
 * @param visited - Set of visited named refs for cycle detection.
 * @returns The resolved template source string.
 */
export function resolveTemplateSource(
  value: string,
  namedTemplates: Record<string, string> | undefined,
  configDir: string,
  visited: Set<string> = new Set(),
): string {
  // File path detection
  if (value.endsWith('.hbs') || value.endsWith('.handlebars')) {
    return readFileSync(resolve(configDir, value), 'utf-8');
  }

  // Named ref
  if (namedTemplates?.[value] !== undefined) {
    if (visited.has(value)) {
      throw new Error(`Circular template reference detected: ${value}`);
    }
    visited.add(value);
    return resolveTemplateSource(
      namedTemplates[value],
      namedTemplates,
      configDir,
      visited,
    );
  }

  // Inline
  return value;
}

/**
 * Create a configured Handlebars instance with built-in helpers registered.
 *
 * @returns A Handlebars instance with helpers.
 */
export function createHandlebarsInstance(): typeof Handlebars {
  const hbs = Handlebars.create();
  registerBuiltinHelpers(hbs);
  return hbs;
}

/**
 * Load custom helpers from file paths.
 *
 * Each file should export a default function that receives the Handlebars instance.
 *
 * @param hbs - The Handlebars instance.
 * @param paths - File paths to custom helper modules.
 * @param configDir - Directory to resolve relative paths against.
 */
export async function loadCustomHelpers(
  hbs: typeof Handlebars,
  paths: string[],
  configDir: string,
): Promise<void> {
  for (const p of paths) {
    const resolved = resolve(configDir, p);
    const mod = (await import(resolved)) as {
      default?: (h: typeof Handlebars) => void;
    };
    if (typeof mod.default === 'function') {
      mod.default(hbs);
    }
  }
}

/**
 * The template engine: holds compiled templates and renders them against context.
 */
export class TemplateEngine {
  private readonly hbs: typeof Handlebars;
  private readonly compiled = new Map<string, CompiledTemplate>();

  constructor(hbs: typeof Handlebars) {
    this.hbs = hbs;
  }

  /**
   * Compile and cache a template from its source string.
   *
   * @param key - Cache key (rule index or named template).
   * @param source - Handlebars template source.
   * @returns The compiled template.
   */
  compile(key: string, source: string): CompiledTemplate {
    const fn = this.hbs.compile(source);
    this.compiled.set(key, fn);
    return fn;
  }

  /**
   * Get a previously compiled template by key.
   *
   * @param key - The cache key.
   * @returns The compiled template, or undefined.
   */
  get(key: string): CompiledTemplate | undefined {
    return this.compiled.get(key);
  }

  /**
   * Render a compiled template against a context.
   *
   * @param key - The cache key of the compiled template.
   * @param context - The data context for rendering.
   * @returns The rendered string, or null if the template was not found.
   */
  render(key: string, context: Record<string, unknown>): string | null {
    const fn = this.compiled.get(key);
    if (!fn) return null;
    return fn(context);
  }
}
