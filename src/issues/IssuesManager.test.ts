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
    manager.record('test.md', 'rule-a', 'fail', 'read_failure');
    const all = manager.getAll();
    expect(all['test.md']).toBeDefined();
    expect(all['test.md'].rule).toBe('rule-a');
    expect(all['test.md'].attempts).toBe(1);
    expect(all['test.md'].errorType).toBe('read_failure');
  });

  it('increments attempts on repeated record', () => {
    manager.record('test.md', 'rule-a', 'fail', 'read_failure');
    manager.record('test.md', 'rule-a', 'fail again', 'read_failure');
    expect(manager.getAll()['test.md'].attempts).toBe(2);
  });

  it('clears a specific issue', () => {
    manager.record('a.md', 'r', 'e', 'embedding');
    manager.record('b.md', 'r', 'e', 'embedding');
    manager.clear('a.md');
    const all = manager.getAll();
    expect(all['a.md']).toBeUndefined();
    expect(all['b.md']).toBeDefined();
  });

  it('clears all issues', () => {
    manager.record('a.md', 'r', 'e', 'embedding');
    manager.record('b.md', 'r', 'e', 'embedding');
    manager.clearAll();
    expect(manager.getAll()).toEqual({});
  });

  it('persists across instances', () => {
    manager.record('test.md', 'rule-a', 'fail', 'type_collision');
    const manager2 = new IssuesManager(tempDir, logger);
    expect(manager2.getAll()['test.md'].rule).toBe('rule-a');
  });
});
