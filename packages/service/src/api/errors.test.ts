/**
 * @module api/errors.test
 * The service's `defineError` classes against core's code table: every class's code and status is in `WATCHER_ERROR_STATUS` and every code there has a class; messages are fixed and capped (`capArg`); `Retry-After` helpers; one pipeline class per issue type; render failures by issue type.
 */

import {
  ISSUE_TYPES,
  WATCHER_ERROR_CODES,
  WATCHER_ERROR_STATUS,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import * as errors from './errors';

const {
  capArg,
  documentBusy,
  embeddingUnavailable,
  isPipelineIssueType,
  MESSAGE_ARG_MAX,
  PIPELINE_ERRORS,
  pipelineErrorCode,
  renderFailureError,
  vcsBusy,
} = errors;

/** An instance of a `defineError` class, as far as this test cares. */
interface Made {
  code: string;
  statusCode: number;
  message: string;
}

/** Every `defineError` class the module exports, plus the pipeline classes. */
const classes: [string, new (...args: string[]) => Made][] = [
  ...Object.entries(errors).filter(
    ([name, value]) =>
      typeof value === 'function' &&
      /^[A-Z]/.test(name) &&
      typeof (new (value as new () => Made)() as Partial<Made>).code ===
        'string',
  ),
  ...Object.entries(PIPELINE_ERRORS),
] as [string, new (...args: string[]) => Made][];

describe('defineError classes', () => {
  it.each(classes)(
    '%s has a code and status from WATCHER_ERROR_STATUS',
    (_name, Cls) => {
      const made = new Cls('a', 'b');
      expect(WATCHER_ERROR_CODES).toContain(made.code);
      expect(made.statusCode).toBe(
        WATCHER_ERROR_STATUS[made.code as keyof typeof WATCHER_ERROR_STATUS],
      );
    },
  );

  it('covers every code in WATCHER_ERROR_STATUS', () => {
    const covered = new Set(classes.map(([, Cls]) => new Cls('a', 'b').code));
    expect([...covered].sort()).toEqual([...WATCHER_ERROR_CODES].sort());
  });

  /** Each class's message (spec 0.22.0 Design 2), `x`/`y` its arguments. */
  const MESSAGES: Record<string, [string[], string]> = {
    Unauthorized: [
      [],
      'A valid API key is required: send Authorization: Bearer <key>.',
    ],
    PathNotWatched: [
      [],
      'The path is outside the watched scope or is gitignored.',
    ],
    RouteNotFound: [['GET', '/x'], 'Route GET:/x not found'],
    PathNotFound: [[], 'The file or directory does not exist.'],
    VcsRootNotFound: [
      [],
      'No version-controlled watch root matches the path or glob.',
    ],
    VcsRootNotVersioned: [
      [],
      'The named root is not a version-controlled watch root.',
    ],
    VcsFileNotFound: [[], 'The file does not exist at that commit.'],
    ExclusionNotFound: [[], 'The pattern is not excluded on this root.'],
    SourceNotIndexed: [[], 'The source document is not indexed.'],
    SourceNotFound: [
      [],
      'The source reports that the document does not exist.',
    ],
    UnsupportedContentType: [
      [],
      'The source returned a body that is not a JSON object.',
    ],
    SourceUnavailable: [
      [],
      'The source could not be reached or answered with an error.',
    ],
    SourcesNotSupported: [
      [],
      'Source documents are not available on this instance.',
    ],
    WatcherNotReady: [[], 'The filesystem watcher is not initialized.'],
    FacetIndexNotReady: [
      ['x'],
      'Facet counts need the x system index, which is not ready yet; retry shortly.',
    ],
    FacetBudgetExceeded: [
      ['x'],
      'Facet counts exceeded the time budget; not counted: x. Count fewer fields or narrow the filter.',
    ],
    DocumentBusy: [[], 'The document is being processed; retry after 10 s.'],
    VcsBusy: [[], 'Version control is busy on this root; retry after 30 s.'],
    PruneNotAvailable: [
      [],
      'Prune needs a vector store, and none is configured.',
    ],
    ScanInProgress: [
      [],
      'The initial filesystem scan is still running; retry when it finishes.',
    ],
    EmbeddingUnavailable: [
      [],
      'The embedding provider is unavailable; retry later.',
    ],
    FilterRejected: [['x'], 'The vector store rejected the filter: x'],
    FacetFieldNotIndexed: [['x'], 'No usable payload index for field(s): x'],
    EmptyRuleList: [[], 'rules must name at least one rule'],
    UnknownRules: [['x'], 'Unknown rule(s): x'],
    MetadataInvalid: [
      ['x'],
      "The metadata does not match the matched rules' schemas: x",
    ],
    RulesInvalid: [['x'], 'The rules are not valid: x'],
    PathNotFileOrDirectory: [[], 'The path is neither a file nor a directory.'],
    ExcludeGlobRefused: [['x'], 'The exclude glob is refused: x'],
  };

  it('pins the message of every class (and no other)', () => {
    const named = classes
      .map(([name]) => name)
      .filter((name) => !(name in PIPELINE_ERRORS));
    expect(named.sort()).toEqual(Object.keys(MESSAGES).sort());
  });

  it.each(Object.entries(MESSAGES))(
    '%s sends its fixed message',
    (name, [args, message]) => {
      const Cls = classes.find(([n]) => n === name)?.[1];
      expect(Cls && new Cls(...args).message).toBe(message);
    },
  );
});

describe('capArg', () => {
  it('leaves an argument up to the limit alone', () => {
    const value = 'x'.repeat(MESSAGE_ARG_MAX);
    expect(capArg(value)).toBe(value);
  });

  it('cuts a longer argument to the limit, marking the cut', () => {
    const capped = capArg('x'.repeat(MESSAGE_ARG_MAX + 1));
    expect(capped).toHaveLength(MESSAGE_ARG_MAX);
    expect(capped).toBe(`${'x'.repeat(MESSAGE_ARG_MAX - 1)}…`);
  });

  it('caps at 300 characters (D204 (3), (4))', () => {
    expect(MESSAGE_ARG_MAX).toBe(300);
  });
});

describe('Retry-After helpers', () => {
  it('documentBusy carries Retry-After: 10', () => {
    expect(documentBusy()).toMatchObject({
      code: 'WATCHER_NOT_AVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': '10' },
    });
  });

  it('vcsBusy carries Retry-After: 30', () => {
    expect(vcsBusy()).toMatchObject({
      code: 'WATCHER_NOT_AVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': '30' },
    });
  });

  it.each([
    [0, '1'],
    [1, '1'],
    [1000, '1'],
    [1001, '2'],
    [2500, '3'],
  ])('embeddingUnavailable rounds %ims up to Retry-After %s', (ms, header) => {
    expect(embeddingUnavailable(ms)).toMatchObject({
      code: 'WATCHER_EMBEDDING_UNAVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': header },
    });
  });

  it('embeddingUnavailable without a known delay sends no Retry-After', () => {
    expect(embeddingUnavailable()).not.toHaveProperty('headers');
  });
});

describe('pipeline codes (D203 (2))', () => {
  it.each([
    ['extraction_error', 'WATCHER_PIPELINE_EXTRACTION_ERROR'],
    ['interpolation_error', 'WATCHER_PIPELINE_INTERPOLATION_ERROR'],
    ['match_failed', 'WATCHER_PIPELINE_MATCH_FAILED_ERROR'],
    ['type_collision', 'WATCHER_PIPELINE_TYPE_COLLISION_ERROR'],
    ['too_large', 'WATCHER_PIPELINE_TOO_LARGE_ERROR'],
  ] as const)('%s -> %s', (issue, code) => {
    expect(pipelineErrorCode(issue)).toBe(code);
  });

  it('has one class per issue type except the two with their own code', () => {
    expect(Object.keys(PIPELINE_ERRORS)).toEqual(
      ISSUE_TYPES.filter(
        (t) => t !== 'source_unavailable' && t !== 'unsupported_content_type',
      ),
    );
    expect(isPipelineIssueType('source_unavailable')).toBe(false);
    expect(isPipelineIssueType('unsupported_content_type')).toBe(false);
    expect(isPipelineIssueType('no_content')).toBe(true);
  });
});

describe('renderFailureError', () => {
  it.each([
    ['source_unavailable', 'WATCHER_SOURCE_UNAVAILABLE', 502],
    ['unsupported_content_type', 'WATCHER_UNSUPPORTED_CONTENT_TYPE', 422],
    ['rule_missing', 'WATCHER_PIPELINE_RULE_MISSING_ERROR', 422],
    [undefined, 'WATCHER_PIPELINE_EXTRACTION_ERROR', 422],
  ] as const)('%s -> %s (%i)', (issue, code, statusCode) => {
    expect(renderFailureError(issue)).toMatchObject({ code, statusCode });
  });
});
