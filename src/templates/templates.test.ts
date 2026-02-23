import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createHandlebarsInstance,
  resolveTemplateSource,
  TemplateEngine,
} from './engine';

// Helper: create a temp dir with files
function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `jw-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('template resolution', () => {
  it('resolves inline template', () => {
    const src = resolveTemplateSource('# {{title}}', undefined, '.');
    expect(src).toBe('# {{title}}');
  });

  it('resolves .hbs file path', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.hbs'), '# {{name}}');
    const src = resolveTemplateSource('test.hbs', undefined, dir);
    expect(src).toBe('# {{name}}');
  });

  it('resolves .handlebars file path', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.handlebars'), 'Hello {{who}}');
    const src = resolveTemplateSource('test.handlebars', undefined, dir);
    expect(src).toBe('Hello {{who}}');
  });

  it('resolves named ref', () => {
    const src = resolveTemplateSource(
      'my-template',
      { 'my-template': '# {{title}}' },
      '.',
    );
    expect(src).toBe('# {{title}}');
  });

  it('resolves named ref pointing to file', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'tmpl.hbs'), 'File: {{x}}');
    const src = resolveTemplateSource('my-ref', { 'my-ref': 'tmpl.hbs' }, dir);
    expect(src).toBe('File: {{x}}');
  });

  it('detects circular references', () => {
    expect(() => resolveTemplateSource('a', { a: 'b', b: 'a' }, '.')).toThrow(
      /circular/i,
    );
  });
});

describe('template engine', () => {
  it('compiles and renders a template', () => {
    const hbs = createHandlebarsInstance();
    const engine = new TemplateEngine(hbs);
    engine.compile('test', '# {{heading}}\n\n{{body}}');
    const result = engine.render('test', {
      heading: 'Hello',
      body: 'World',
    });
    expect(result).toBe('# Hello\n\nWorld');
  });

  it('returns null for unknown template key', () => {
    const hbs = createHandlebarsInstance();
    const engine = new TemplateEngine(hbs);
    expect(engine.render('nonexistent', {})).toBeNull();
  });
});

describe('built-in helpers', () => {
  const hbs = createHandlebarsInstance();

  function render(template: string, context: Record<string, unknown>): string {
    return hbs.compile(template)(context);
  }

  it('dateFormat formats dates', () => {
    const result = render("{{dateFormat date 'YYYY-MM-DD'}}", {
      date: '2026-02-15T14:30:00.000Z',
    });
    expect(result).toBe('2026-02-15');
  });

  it('join joins arrays', () => {
    const result = render('{{join items ", "}}', {
      items: ['a', 'b', 'c'],
    });
    expect(result).toBe('a, b, c');
  });

  it('pluck extracts field from array of objects', () => {
    const result = render('{{join (pluck items "name") ", "}}', {
      items: [{ name: 'alpha' }, { name: 'beta' }],
    });
    expect(result).toBe('alpha, beta');
  });

  it('default provides fallback', () => {
    expect(render('{{default name "Unknown"}}', {})).toBe('Unknown');
    expect(render('{{default name "Unknown"}}', { name: 'Alice' })).toBe(
      'Alice',
    );
  });

  it('eq compares values', () => {
    expect(render('{{#if (eq a b)}}yes{{else}}no{{/if}}', { a: 1, b: 1 })).toBe(
      'yes',
    );
    expect(render('{{#if (eq a b)}}yes{{else}}no{{/if}}', { a: 1, b: 2 })).toBe(
      'no',
    );
  });

  it('json outputs JSON', () => {
    const result = render('{{{json data}}}', { data: { x: 1 } });
    expect(JSON.parse(result)).toEqual({ x: 1 });
  });

  it('lowercase/uppercase transform strings', () => {
    expect(render('{{lowercase text}}', { text: 'HELLO' })).toBe('hello');
    expect(render('{{uppercase text}}', { text: 'hello' })).toBe('HELLO');
  });

  it('capitalize capitalizes first letter', () => {
    expect(render('{{capitalize text}}', { text: 'hello world' })).toBe(
      'Hello world',
    );
  });

  it('title title-cases', () => {
    const result = render('{{title text}}', { text: 'hello world' });
    expect(result).toBe('Hello World');
  });

  it('camel/snake/dash transform case', () => {
    expect(render('{{camel text}}', { text: 'hello world' })).toBe(
      'helloWorld',
    );
    expect(render('{{snake text}}', { text: 'hello world' })).toBe(
      'hello_world',
    );
    expect(render('{{dash text}}', { text: 'hello world' })).toBe(
      'hello-world',
    );
  });

  it('markdownify converts HTML to markdown', () => {
    const result = render('{{{markdownify html}}}', {
      html: '<h1>Title</h1><p>Hello <strong>world</strong></p>',
    });
    expect(result).toContain('Title');
    expect(result).toContain('**world**');
  });

  it('adfToMarkdown converts ADF to markdown', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello from ADF' }],
        },
      ],
    };
    const result = render('{{{adfToMarkdown doc}}}', { doc: adf });
    expect(result).toContain('Hello from ADF');
  });

  it('adfToMarkdown returns empty for non-object', () => {
    expect(render('{{{adfToMarkdown val}}}', { val: null })).toBe('');
    expect(render('{{{adfToMarkdown val}}}', { val: 'string' })).toBe('');
  });

  it('markdownify returns empty for non-string', () => {
    expect(render('{{{markdownify val}}}', { val: 42 })).toBe('');
  });
});

describe('error handling', () => {
  it('handles missing fields gracefully', () => {
    const hbs = createHandlebarsInstance();
    const engine = new TemplateEngine(hbs);
    engine.compile('test', '# {{heading}}\n\n{{body}}');
    const result = engine.render('test', {});
    expect(result).toBe('# \n\n');
  });
});
