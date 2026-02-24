/**
 * @module templates/buildTemplateEngine
 * Factory to build a TemplateEngine from config, compiling all rule templates at load time.
 */

import type { InferenceRule } from '../config/types';
import {
  createHandlebarsInstance,
  loadCustomHelpers,
  resolveTemplateSource,
  TemplateEngine,
} from './engine';

/**
 * Resolve a template config entry to its source string.
 */
function resolveTemplateEntry(
  entry: string | { template: string; description?: string },
): string {
  return typeof entry === 'string' ? entry : entry.template;
}

/**
 * Build a TemplateEngine from configuration, pre-compiling all rule templates.
 *
 * @param rules - The inference rules (may contain template fields).
 * @param namedTemplates - Named template definitions from config.
 * @param templateHelpers - Custom helper registrations with paths and descriptions.
 * @param configDir - Directory to resolve relative paths against.
 * @returns The configured TemplateEngine, or undefined if no templates are used.
 */
export async function buildTemplateEngine(
  rules: InferenceRule[],
  namedTemplates?: Record<
    string,
    string | { template: string; description?: string }
  >,
  templateHelpers?: Record<string, { path: string; description?: string }>,
  configDir?: string,
): Promise<TemplateEngine | undefined> {
  const rulesWithTemplates = rules.filter((r) => r.template);
  if (rulesWithTemplates.length === 0) return undefined;

  const hbs = createHandlebarsInstance();

  // Load custom helpers
  if (templateHelpers && Object.keys(templateHelpers).length > 0 && configDir) {
    await loadCustomHelpers(hbs, templateHelpers, configDir);
  }

  const engine = new TemplateEngine(hbs);

  // Flatten named templates to plain string map for resolution
  const flatTemplates: Record<string, string> | undefined = namedTemplates
    ? Object.fromEntries(
        Object.entries(namedTemplates).map(([k, v]) => [
          k,
          resolveTemplateEntry(v),
        ]),
      )
    : undefined;

  // Compile all rule templates
  for (const rule of rules) {
    if (!rule.template) continue;
    const source = resolveTemplateSource(
      rule.template,
      flatTemplates,
      configDir ?? '.',
    );
    engine.compile(rule.name, source);
  }

  return engine;
}
