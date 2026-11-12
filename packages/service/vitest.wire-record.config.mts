/**
 * Vitest config for recording wire records: runs one `src/test/wire/*.record.ts` suite, which writes its records to the file named by `WIRE_RECORD`. The suite is `wireRecord` (every scenario; used by `scripts/capture-wire-0.20.0.mjs`) unless `WIRE_RECORD_SUITE` names another (`wireErrors`: the 0.22.0 error overlay). Not part of `npm test`.
 */
import base from './vitest.config';

const suite = process.env.WIRE_RECORD_SUITE ?? 'wireRecord';

// The base config's test projects would run the whole suite; record only.
const { projects: _projects, ...test } = base.test ?? {};

export default {
  ...base,
  test: { ...test, include: [`src/test/wire/${suite}.record.ts`] },
};
