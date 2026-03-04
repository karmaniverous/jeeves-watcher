/**
 * @module templates/renderDoc
 * Declarative renderer for YAML frontmatter + structured Markdown body.
 */

import type Handlebars from 'handlebars';
import { title } from 'radash';

import type {
  RenderBodySection,
  RenderConfig,
} from '../config/schemas/inference';
import { rebaseHeadings } from './rebaseHeadings';
import { yamlValue } from './yamlEscape';

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function renderSectionHeading(
  section: RenderBodySection,
  hbs: typeof Handlebars,
  context: Record<string, unknown> = {},
): string {
  const level = Math.min(6, Math.max(1, section.heading));
  const label = section.label
    ? hbs.compile(section.label, { noEscape: true })(context)
    : title(section.path);
  return `${'#'.repeat(level)} ${label}`;
}

function callFormatHelper(
  hbs: typeof Handlebars,
  helperName: string,
  value: unknown,
  args: unknown[] | undefined,
): string {
  const helper = (hbs.helpers as Record<string, unknown>)[helperName];
  if (typeof helper !== 'function') {
    throw new Error(`Format helper not found: ${helperName}`);
  }

  // Handlebars helpers may return SafeString or other values; coerce to string
  const safeArgs: unknown[] = args ?? [];
  const result = (helper as (...a: unknown[]) => unknown)(value, ...safeArgs);
  return typeof result === 'string' ? result : String(result);
}

function renderValueAsMarkdown(
  hbs: typeof Handlebars,
  section: RenderBodySection,
  value: unknown,
): string {
  if (value === null || value === undefined) return '';

  if (section.format) {
    const md = callFormatHelper(hbs, section.format, value, section.formatArgs);
    return rebaseHeadings(md, section.heading);
  }

  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function renderEach(
  hbs: typeof Handlebars,
  section: RenderBodySection,
  value: unknown,
): string {
  if (!Array.isArray(value)) return '';

  const items = [...(value as unknown[])];
  if (section.sort) {
    items.sort((a, b) => {
      const av = getPath(a, section.sort as string);
      const bv = getPath(b, section.sort as string);
      const aStr = typeof av === 'string' ? av : JSON.stringify(av ?? '');
      const bStr = typeof bv === 'string' ? bv : JSON.stringify(bv ?? '');
      return aStr.localeCompare(bStr);
    });
  }

  const subHeadingLevel = Math.min(6, section.heading + 1);
  const headingTpl = section.headingTemplate
    ? hbs.compile(section.headingTemplate, { noEscape: true })
    : undefined;

  const parts: string[] = [];
  for (const item of items) {
    const headingText = headingTpl
      ? headingTpl(item as Record<string, unknown>)
      : '';
    if (headingText) {
      parts.push(`${'#'.repeat(subHeadingLevel)} ${headingText}`);
    }

    const contentVal: unknown = section.contentPath
      ? getPath(item, section.contentPath)
      : item;
    const md = renderValueAsMarkdown(
      hbs,
      { ...section, heading: subHeadingLevel } as RenderBodySection,
      contentVal,
    );
    if (md.trim()) parts.push(md.trim());
  }

  return parts.join('\n\n');
}

/**
 * Render a document according to a RenderConfig.
 */
export function renderDoc(
  context: Record<string, unknown>,
  config: RenderConfig,
  hbs: typeof Handlebars,
): string {
  const parts: string[] = [];

  // Frontmatter
  const fmLines: string[] = [];
  for (const key of config.frontmatter) {
    const v = getPath(context, key);
    const rendered = yamlValue(v);
    if (!rendered) continue;
    fmLines.push(`${key}: ${rendered}`);
  }
  if (fmLines.length > 0) {
    parts.push('---');
    parts.push(fmLines.join('\n'));
    parts.push('---');
    parts.push('');
  }

  // Body
  for (const section of config.body) {
    const heading = renderSectionHeading(section, hbs, context);
    parts.push(heading);
    parts.push('');

    const v = getPath(context, section.path);
    const body = section.each
      ? renderEach(hbs, section, v)
      : renderValueAsMarkdown(hbs, section, v);
    if (body.trim()) {
      parts.push(body.trim());
    }
    parts.push('');
  }

  return parts.join('\n').trim() + '\n';
}
