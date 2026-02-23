/**
 * @module templates
 * Content template engine: Handlebars compilation, resolution, and built-in helpers.
 */

export { buildTemplateEngine } from './buildTemplateEngine';
export {
  type CompiledTemplate,
  createHandlebarsInstance,
  loadCustomHelpers,
  resolveTemplateSource,
  TemplateEngine,
} from './engine';
export { registerBuiltinHelpers } from './helpers';
