import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IssuesManager } from './IssuesManager';

describe('IssuesManager', () => {
  let tempDir: string;
  let manager: IssuesManager;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'issues-test-'));
    manager = new IssuesManager(tempDir, logger);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    expect(manager.getAll()).toEqual({});
  });

  it('records an issue', () => {
    manager.record('test.md', 'interpolation_error', 'Template failed', {
      property: 'title',
      rules: ['rule-a'],
    });
    const all = manager.getAll();
    expect(all['test.md']).toBeDefined();
    const issues = all['test.md']!;
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('interpolation_error');
    expect(issues[0].property).toBe('title');
  });

  it('appends multiple issues for the same file', () => {
    manager.record('test.md', 'interpolation_error', 'First error');
    manager.record('test.md', 'type_collision', 'Second error');
    const issues = manager.getAll()['test.md']!;
    expect(issues.length).toBe(2);
    expect(issues[0].type).toBe('interpolation_error');
    expect(issues[1].type).toBe('type_collision');
  });

  it('clears a specific issue', () => {
    manager.record('a.md', 'interpolation_error', 'Error A');
    manager.record('b.md', 'interpolation_error', 'Error B');
    manager.clear('a.md');
    const all = manager.getAll();
    expect(all['a.md']).toBeUndefined();
    expect(all['b.md']).toBeDefined();
  });

  it('clears all issues', () => {
    manager.record('a.md', 'interpolation_error', 'Error A');
    manager.record('b.md', 'interpolation_error', 'Error B');
    manager.clearAll();
    expect(manager.getAll()).toEqual({});
  });

  it('persists across instances', () => {
    manager.record('test.md', 'type_collision', 'Type mismatch', {
      property: 'status',
      rules: ['rule-a', 'rule-b'],
      types: ['string', 'integer'],
    });
    const manager2 = new IssuesManager(tempDir, logger);
    const issues = manager2.getAll()['test.md']!;
    expect(issues[0].rules).toEqual(['rule-a', 'rule-b']);
    expect(issues[0].types).toEqual(['string', 'integer']);
  });

  describe('type_collision issue', () => {
    it('records with property, rules, and types', () => {
      manager.record('collision.json', 'type_collision', 'Type collision', {
        property: 'created',
        rules: ['jira-issue', 'frontmatter-created'],
        types: ['integer', 'string'],
      });

      const issues = manager.getAll()['collision.json']!;
      expect(issues).toBeDefined();
      expect(issues.length).toBe(1);
      expect(issues[0]).toMatchObject({
        type: 'type_collision',
        property: 'created',
        rules: ['jira-issue', 'frontmatter-created'],
        types: ['integer', 'string'],
        message: 'Type collision',
      });
      expect(issues[0].timestamp).toBeTypeOf('number');
    });

    it('stores array-per-file-path structure', () => {
      manager.record('file1.md', 'type_collision', 'Collision 1', {
        property: 'field_a',
        rules: ['rule1', 'rule2'],
        types: ['string', 'integer'],
      });
      manager.record('file2.md', 'type_collision', 'Collision 2', {
        property: 'field_b',
        rules: ['rule3', 'rule4'],
        types: ['number', 'boolean'],
      });

      const all = manager.getAll();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['file1.md']).toBeInstanceOf(Array);
      expect(all['file2.md']).toBeInstanceOf(Array);
      expect(all['file1.md']![0].property).toBe('field_a');
      expect(all['file2.md']![0].property).toBe('field_b');
    });
  });

  describe('interpolation_error issue', () => {
    it('records with property and rule', () => {
      manager.record(
        'interpolation.json',
        'interpolation_error',
        "Failed to resolve ${json.from.email}: 'from' is null",
        {
          property: 'author_email',
          rule: 'email-archive',
        },
      );

      const issues = manager.getAll()['interpolation.json']!;
      expect(issues).toBeDefined();
      expect(issues.length).toBe(1);
      expect(issues[0]).toMatchObject({
        type: 'interpolation_error',
        property: 'author_email',
        rule: 'email-archive',
        message: "Failed to resolve ${json.from.email}: 'from' is null",
      });
      expect(issues[0].timestamp).toBeTypeOf('number');
    });
  });

  describe('self-healing', () => {
    it('clears issue on successful reprocess', () => {
      manager.record('healing.md', 'interpolation_error', 'Initial error', {
        property: 'title',
        rule: 'frontmatter-title',
      });
      expect(manager.getAll()['healing.md']).toBeDefined();

      // Simulate successful reprocess
      manager.clear('healing.md');
      expect(manager.getAll()['healing.md']).toBeUndefined();
    });

    it('maintains other file issues when clearing one', () => {
      manager.record('file1.md', 'interpolation_error', 'Error 1');
      manager.record('file2.md', 'type_collision', 'Error 2');
      manager.record('file3.md', 'interpolation_error', 'Error 3');

      manager.clear('file2.md');

      const all = manager.getAll();
      expect(all['file1.md']).toBeDefined();
      expect(all['file2.md']).toBeUndefined();
      expect(all['file3.md']).toBeDefined();
    });
  });
});
