/**
 * @module processor/resolvers/SourceResolver.extractText.test
 * Source rules get no file reader: applyRules receives `extractText: undefined`, so a map's fetchSiblings cannot read server files for a source document.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../../config/types';
import * as rules from '../../rules';
import type { SourceRetriever } from '../../sources';
import { SourceResolver } from './SourceResolver';

const rule: InferenceRule = {
  name: 'plain',
  description: 'Plain JSON',
  match: { type: 'object', required: ['source'] },
};

describe('SourceResolver file access', () => {
  it('applies the rule without a file reader', async () => {
    const applyRules = vi.spyOn(rules, 'applyRules');
    const retriever: SourceRetriever = {
      resolve: vi.fn(),
      retrieve: vi.fn(() =>
        Promise.resolve({ kind: 'document' as const, body: { a: 1 } }),
      ),
    };
    const resolver = new SourceResolver({
      compiledRules: rules.compileRules([rule]),
      config: {},
      logger: pino({ level: 'silent' }),
      retriever,
    });

    await resolver.resolve({ ref: 'app://x', rule: 'plain' });

    expect(applyRules).toHaveBeenCalledOnce();
    const options = applyRules.mock.calls[0][2];
    expect(options).toHaveProperty('extractText', undefined);
  });
});
