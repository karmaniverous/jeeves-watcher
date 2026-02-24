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
});
