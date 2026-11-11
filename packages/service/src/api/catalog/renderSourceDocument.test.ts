/**
 * @module api/catalog/renderSourceDocument.test
 * `renderSourceDocument`: success body, `WATCHER_SOURCE_NOT_INDEXED` /
 * `WATCHER_SOURCE_NOT_FOUND`, and each render failure thrown as its class by
 * issue type (D203 (2)), with the failure's message and details logged.
 */

import { ISSUE_TYPES } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it, vi } from 'vitest';

import { pipelineErrorCode } from '../errors';
import { renderSourceDocument } from './renderSourceDocument';

function processorWith(ops: {
  storedRule: () => Promise<string | null>;
  render: () => Promise<unknown>;
}) {
  return { sourceOperations: () => ops } as never;
}

const logger = () => ({ warn: vi.fn() });

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

    const body = await renderSourceDocument(
      processor,
      'app://chat/1',
      logger(),
    );

    expect(body).toEqual({
      renderAs: 'md',
      content: '# Chat',
      rules: ['chat'],
      metadata: { channel: 'c1' },
    });
  });

  it('throws 404 WATCHER_SOURCE_NOT_INDEXED when no stored rule exists', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve(null),
      render: vi.fn(),
    });

    await expect(
      renderSourceDocument(processor, 'app://chat/1', logger()),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_SOURCE_NOT_INDEXED',
    });
  });

  it('throws 404 WATCHER_SOURCE_NOT_FOUND when the callback answers gone', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () => Promise.resolve({ kind: 'gone' }),
    });

    await expect(
      renderSourceDocument(processor, 'app://chat/1', logger()),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_SOURCE_NOT_FOUND',
    });
  });

  /** Every issue type with the code and status its failure is sent with. */
  const cases = ISSUE_TYPES.map((issue): [string, string, number] =>
    issue === 'source_unavailable'
      ? [issue, 'WATCHER_SOURCE_UNAVAILABLE', 502]
      : issue === 'unsupported_content_type'
        ? [issue, 'WATCHER_UNSUPPORTED_CONTENT_TYPE', 422]
        : [issue, pipelineErrorCode(issue), 422],
  );

  it.each(cases)(
    'maps failure %s to %s (%i), logging message and details',
    async (issue, code, statusCode) => {
      const details = { stage: issue };
      const log = logger();
      const processor = processorWith({
        storedRule: () => Promise.resolve('chat'),
        render: () =>
          Promise.resolve({
            kind: 'failed',
            error: { code: issue, message: `${issue} happened`, details },
          }),
      });

      const error = (await renderSourceDocument(
        processor,
        'app://chat/1',
        log,
      ).catch((e: unknown) => e)) as Error;

      expect(error).toMatchObject({ statusCode, code });
      expect(error.message).not.toContain('happened');
      expect(log.warn).toHaveBeenCalledWith(
        {
          source: 'app://chat/1',
          issueType: issue,
          message: `${issue} happened`,
          details,
        },
        'Render failed',
      );
    },
  );

  it('maps an unknown failure code to an extraction error', async () => {
    const processor = processorWith({
      storedRule: () => Promise.resolve('chat'),
      render: () =>
        Promise.resolve({
          kind: 'failed',
          error: { code: 'not_an_issue_type', message: 'odd', details: {} },
        }),
    });

    await expect(
      renderSourceDocument(processor, 'app://chat/1', logger()),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'WATCHER_PIPELINE_EXTRACTION_ERROR',
    });
  });
});
