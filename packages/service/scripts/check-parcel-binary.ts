/**
 * @module scripts/check-parcel-binary
 * CI install check (D125, R3): `@parcel/watcher`'s platform binary loads, subscribes a temp directory with the explicit backend (never watchman), delivers an event for a written file, and unsubscribes. Exits non-zero otherwise. I/O: a temp directory.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadParcelWatcher,
  parcelBackend,
} from '../src/watcher/changeSource/parcelModule';

const TIMEOUT_MS = 10_000;

const parcel = await loadParcelWatcher();
const backend = parcelBackend();
const dir = await realpath(await mkdtemp(join(tmpdir(), 'parcel-check-')));
const target = join(dir, 'probe.txt');
let resolveSeen: () => void = () => undefined;
const seen = new Promise<void>((resolve) => {
  resolveSeen = resolve;
});
const subscription = await parcel.subscribe(
  dir,
  (err, events) => {
    if (err) throw err;
    if (events.some((event) => event.path === target)) resolveSeen();
  },
  { backend },
);
await writeFile(target, 'probe');
const timer = setTimeout(() => {
  console.error(
    `no parcel event for ${target} within ${String(TIMEOUT_MS)} ms`,
  );
  process.exit(1);
}, TIMEOUT_MS);
await seen;
clearTimeout(timer);
await subscription.unsubscribe();
await rm(dir, { recursive: true, force: true });
console.log(
  `@parcel/watcher loaded on ${process.platform}-${process.arch}; backend ${backend}: subscribe, event and unsubscribe ok`,
);
