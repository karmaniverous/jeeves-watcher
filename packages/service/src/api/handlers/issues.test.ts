import { describe, expect, it } from 'vitest';

import type { IssuesManager } from '../../issues';
import type { IssuesFile } from '../../issues/types';
import { createIssuesHandler } from './issues';

describe('GET /issues handler', () => {
  it('returns count and issues', () => {
    const issues: IssuesFile = {
      'a.md': [{ type: 'interpolation_error', message: 'x', timestamp: 0 }],
      'b.md': [{ type: 'type_collision', message: 'y', timestamp: 0 }],
    };

    const handler = createIssuesHandler({
      issuesManager: {
        getAll: () => issues,
      } as unknown as IssuesManager,
    });

    const result = handler();
    expect(result.count).toBe(2);
    expect(Object.keys(result.issues)).toEqual(['a.md', 'b.md']);
  });
});
