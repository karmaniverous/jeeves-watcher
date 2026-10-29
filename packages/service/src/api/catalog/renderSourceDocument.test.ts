/**
 * @module api/catalog/renderSourceDocument.test
 * `renderSourceDocument`: success body, `source_not_indexed`/`source_not_found`
 * and the three failed-pipeline codes, each thrown as a `RequestError`.
 */

import { describe, expect, it, vi } from 'vitest';

import { RequestError } from '../requestError';
import { renderSourceDocument } from './renderSourceDocument';

function processorWith(ops: {
  storedRule: () => Promise<string | null>;
  render: () => Promise<unknown>;
}) {
  return { sourceOperations: () => ops } as never;
}

describe('renderSourceDocument', () => {
  it('returns the rendered body on success', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () =>
        Promise.resolve({
          kind: 'ok',
          result: {
            renderAs: 'md',
            content: '# Chat',
            rules: ['chat'],
            metadata: { channel: 'c1' },
          },
        }),
    });

    const body = await renderSourceDocument(processor, 'app://chat/1');

    expect(body).toEqual({
      renderAs: 'md',
      content: '# Chat',
      rules: ['chat'],
      metadata: { channel: 'c1' },
    });
  });

  it('throws source_not_indexed when no stored rule exists', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve(null),
      render: vi.fn(),
    });

    await expect(
      renderSourceDocument(processor, 'app://chat/1'),
    ).rejects.toMatchObject({ code: 'source_not_indexed' });
  });

  it('throws source_not_found when the callback answers gone', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () => Promise.resolve({ kind: 'gone' }),
    });

    await expect(
      renderSourceDocument(processor, 'app://chat/1'),
    ).rejects.toMatchObject({ code: 'source_not_found' });
  });

  it.each([
    ['source_unavailable', 'source_unavailable'],
    ['unsupported_content_type', 'unsupported_content_type'],
    ['rule_missing', 'pipeline_error'],
  ])('maps failure %s to %s', async (issue, expectedCode) => {
    const details = { stage: issue };
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () =>
        Promise.resolve({
          kind: 'failed',
          error: { code: issue, message: `${issue} happened`, details },
        }),
    });

    const error = (await renderSourceDocument(processor, 'app://chat/1').catch(
      (e: unknown) => e,
    )) as RequestError;

    expect(error).toBeInstanceOf(RequestError);
    expect(error.code).toBe(expectedCode);
    expect(error.message).toBe(`${issue} happened`);
    expect(error.extras).toEqual({ details, issueType: issue });
  });

  it('omits issueType when the failure code is not a known issue type', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () =>
        Promise.resolve({
          kind: 'failed',
          error: { code: 'not_an_issue_type', message: 'odd', details: {} },
        }),
    });

    const error = (await renderSourceDocument(processor, 'app://chat/1').catch(
      (e: unknown) => e,
    )) as RequestError;

    expect(error.code).toBe('pipeline_error');
    expect(error.extras).toEqual({ details: {}, issueType: undefined });
  });
});
