/**
 * @module plugin/writerIntegration.test
 * Integration tests for the ComponentWriter lifecycle.
 *
 * @remarks
 * BLOCKED: `@karmaniverous/jeeves` v0.1.0 has a createRequire path bug —
 * rollup flattens `dist/constants/version.js` into `dist/index.js` so the
 * `require('../../package.json')` resolves to a non-existent path. The fix
 * is tracked upstream; once v0.1.1+ is published with a corrected path,
 * un-skip these tests.
 */

import { describe, it } from 'vitest';

describe('jeeves-core integration (watcher plugin)', () => {
  it.todo(
    'writes Watcher section as a managed TOOLS.md section and preserves user content',
  );

  it.todo('maintains SOUL.md and AGENTS.md managed content');
});
