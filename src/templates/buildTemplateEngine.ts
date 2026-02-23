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
 * Build a TemplateEngine from configuration, pre-compiling all rule templates.
 *
 * @param rules - The inference rules (may contain template fields).
 * @param namedTemplates - Named template definitions from config.
 * @param templateHelperPaths - Paths to custom helper modules.
 * @param configDir - Directory to resolve relative paths against.
 * @returns The configured TemplateEngine, or undefined if no templates are used.
 */
export async function buildTemplateEngine(
  rules: InferenceRule[],
  namedTemplates?: Record<string, string>,
  templateHelperPaths?: string[],
  configDir?: string,
): Promise<TemplateEngine | undefined> {
  const rulesWithTemplates = rules.filter((r) => r.template);
  if (rulesWithTemplates.length === 0) return undefined;

  const hbs = createHandlebarsInstance();

  // Load custom helpers
  if (templateHelperPaths?.length && configDir) {
    await loadCustomHelpers(hbs, templateHelperPaths, configDir);
  }

  const engine = new TemplateEngine(hbs);

  // Compile all rule templates
  for (const [index, rule] of rules.entries()) {
    if (!rule.template) continue;
    const source = resolveTemplateSource(
      rule.template,
      namedTemplates,
      configDir ?? '.',
    );
    engine.compile(`rule-${String(index)}`, source);
  }

  return engine;
}
