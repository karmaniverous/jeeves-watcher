/**
 * @module test/wire/scenarios022
 * Wire scenarios the 0.20.0 baseline never recorded (spec 0.22.0 Design 5): the 401s, `excludeVcsPath`'s `confirmRequired` reply, a busy document lock, a source render per pipeline code, an unknown route beside a gated one, and the masked 500s. Their expected records live in the 0.22.0 overlay only. Writes temp files in a setup; no assertions.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ISSUE_TYPES,
  VCS_EXCLUDE_CONFIRM_THRESHOLD,
} from '@karmaniverous/jeeves-watcher-core';

import { execFileAsync } from '../git';
import type { WireScenario } from './scenarios';

/**
 * Stage one more file than the confirm threshold under `bulk/`, so excluding
 * `bulk/` would untrack them all.
 *
 * @param vcsRoot - The wire app's VCS root.
 */
async function stageBulkFiles(vcsRoot: string): Promise<void> {
  const dir = join(vcsRoot, 'bulk');
  await mkdir(dir, { recursive: true });
  for (let i = 0; i <= VCS_EXCLUDE_CONFIRM_THRESHOLD; i++) {
    await writeFile(join(dir, `f${String(i)}.log`), String(i), 'utf8');
  }
  await execFileAsync('git', ['add', 'bulk'], { cwd: vcsRoot });
}

/**
 * The source-render scenario of each pipeline issue type. The stub source
 * answers with any issue type; `type_collision`, `embedding_error`,
 * `upsert_error` and `too_large` are stub-only here (no render raises them
 * today), recorded so every pipeline code's body is pinned.
 */
const PIPELINE_RENDERS: WireScenario[] = ISSUE_TYPES.filter(
  (type) =>
    type !== 'source_unavailable' && type !== 'unsupported_content_type',
).map((type) => ({
  name: `render source ${type}`,
  method: 'POST',
  url: '/render',
  payload: { source: 'app://chat/1' },
  state: { sourceRender: type },
}));

/** Every scenario new in 0.22.0, in run order. */
export const WIRE_SCENARIOS_022: readonly WireScenario[] = [
  {
    name: 'unauthorized without key',
    method: 'GET',
    url: '/issues',
    auth: 'none',
  },
  {
    name: 'unauthorized wrong key',
    method: 'GET',
    url: '/issues',
    auth: 'wrong',
  },
  { name: 'unknown route', method: 'GET', url: '/vcs/nope?x=1' },
  {
    name: 'gated route',
    method: 'GET',
    url: '/vcs/status?x=1',
    withoutVcs: true,
  },
  {
    name: 'vcsExclude confirm required',
    method: 'POST',
    url: '/vcs/exclude',
    payload: { glob: '{root}/bulk/**' },
    setup: stageBulkFiles,
  },
  {
    name: 'metadata source busy',
    method: 'POST',
    url: '/metadata',
    payload: { source: 'app://chat/1', metadata: { title: 'x' } },
    state: { documentBusy: true },
  },
  ...PIPELINE_RENDERS,
  {
    name: 'search masked plain error',
    method: 'POST',
    url: '/search',
    payload: { query: 'q' },
    state: { embedFailure: 'plain' },
  },
  {
    name: 'search masked qdrant error',
    method: 'POST',
    url: '/search',
    payload: { query: 'q' },
    state: { embedFailure: 'qdrant' },
  },
  {
    name: 'search masked status and headers',
    method: 'POST',
    url: '/search',
    payload: { query: 'q' },
    state: { embedFailure: 'statusHeaders' },
  },
];
