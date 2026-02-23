/**
 * @module templates/helpers
 * Registers built-in Handlebars helpers for content templates.
 */

import dayjs from 'dayjs';
import type Handlebars from 'handlebars';
import type { Root as HastRoot } from 'hast';
import { toMdast } from 'hast-util-to-mdast';
import { fromADF } from 'mdast-util-from-adf';
import { toMarkdown } from 'mdast-util-to-markdown';
import { camel, capitalize, dash, isEqual, snake, title } from 'radash';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';

/** Pre-built rehype parser for HTML → hast conversion. */
const htmlParser = unified().use(rehypeParse, { fragment: true });

/**
 * Register all built-in helpers on a Handlebars instance.
 *
 * @param hbs - The Handlebars instance.
 */
export function registerBuiltinHelpers(hbs: typeof Handlebars): void {
  // Structural: ADF → Markdown
  hbs.registerHelper('adfToMarkdown', function (adf: unknown) {
    if (!adf || typeof adf !== 'object') return '';
    try {
      const mdast = fromADF(adf as Parameters<typeof fromADF>[0]);
      return new hbs.SafeString(toMarkdown(mdast).trim());
    } catch {
      return '<!-- ADF conversion failed -->';
    }
  });

  // Structural: HTML → Markdown
  hbs.registerHelper('markdownify', function (html: unknown) {
    if (typeof html !== 'string' || !html.trim()) return '';
    try {
      const hast = htmlParser.parse(html) as unknown as HastRoot;
      const mdast = toMdast(hast);
      return new hbs.SafeString(toMarkdown(mdast).trim());
    } catch {
      return '<!-- HTML conversion failed -->';
    }
  });

  // Formatting: dateFormat
  hbs.registerHelper('dateFormat', function (value: unknown, format: unknown) {
    if (value === undefined || value === null) return '';
    const fmt = typeof format === 'string' ? format : 'YYYY-MM-DD';
    return dayjs(value as string | number | Date).format(fmt);
  });

  // Formatting: join
  hbs.registerHelper('join', function (arr: unknown, separator: unknown) {
    if (!Array.isArray(arr)) return '';
    const sep = typeof separator === 'string' ? separator : ', ';
    return arr.join(sep);
  });

  // Formatting: pluck
  hbs.registerHelper('pluck', function (arr: unknown, key: unknown) {
    if (!Array.isArray(arr) || typeof key !== 'string') return [];
    return arr.map((item: unknown) =>
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)[key]
        : undefined,
    );
  });

  // String transforms
  hbs.registerHelper('lowercase', (text: unknown) =>
    typeof text === 'string' ? text.toLowerCase() : '',
  );
  hbs.registerHelper('uppercase', (text: unknown) =>
    typeof text === 'string' ? text.toUpperCase() : '',
  );
  hbs.registerHelper('capitalize', (text: unknown) =>
    typeof text === 'string' ? capitalize(text) : '',
  );
  hbs.registerHelper('title', (text: unknown) =>
    typeof text === 'string' ? title(text) : '',
  );
  hbs.registerHelper('camel', (text: unknown) =>
    typeof text === 'string' ? camel(text) : '',
  );
  hbs.registerHelper('snake', (text: unknown) =>
    typeof text === 'string' ? snake(text) : '',
  );
  hbs.registerHelper('dash', (text: unknown) =>
    typeof text === 'string' ? dash(text) : '',
  );

  // default helper
  hbs.registerHelper('default', function (value: unknown, fallback: unknown) {
    return value ?? fallback ?? '';
  });

  // eq helper (deep equality)
  hbs.registerHelper('eq', function (a: unknown, b: unknown) {
    return isEqual(a, b);
  });

  // json helper
  hbs.registerHelper('json', function (value: unknown) {
    return new hbs.SafeString(JSON.stringify(value, null, 2));
  });
}
