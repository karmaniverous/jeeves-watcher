/**
 * Vitest config for recording the wire baseline: runs only `src/test/wire/wireRecord.record.ts`, which writes every scenario's answer to the file named by `WIRE_RECORD`. Used by `scripts/capture-wire-0.20.0.mjs`; not part of `npm test`.
 */
import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: { include: ['src/test/wire/wireRecord.record.ts'] },
  }),
);
