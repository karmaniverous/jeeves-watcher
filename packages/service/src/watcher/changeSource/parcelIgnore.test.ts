/**
 * @module watcher/changeSource/parcelIgnore.test
 * The exact `watch.ignored` rewrite rule for parcel (D126, D152, D156), table-tested on both platforms' path forms.
 */

import { describe, expect, it } from 'vitest';

import { parcelIgnore, rootRelativeIgnore } from './parcelIgnore';

describe('rootRelativeIgnore', () => {
  it.each([
    // Relative patterns pass unchanged.
    ['**/node_modules/**', 'j:/domains', 'win32', '**/node_modules/**'],
    ['*.tmp', '/srv/root', 'linux', '*.tmp'],
    // Absolute, literal prefix at or under the root: made relative.
    ['j:/domains/archive/**', 'j:/domains', 'win32', 'archive/**'],
    ['J:\\Domains\\archive\\**', 'j:/domains', 'win32', 'archive/**'],
    ['j:/domains/**/cache/**', 'j:/domains', 'win32', '**/cache/**'],
    ['j:/domains/junk', 'J:\\domains', 'win32', 'junk'],
    ['/srv/root/build/**', '/srv/root', 'linux', 'build/**'],
    ['/srv/root/**/x', '/srv/root/', 'linux', '**/x'],
    // Linux compares case-sensitively.
    ['/srv/Root/build/**', '/srv/root', 'linux', undefined],
    // Literal prefix above the root, or outside it: omitted.
    ['j:/**/x/**', 'j:/domains', 'win32', undefined],
    ['j:/dom*/x/**', 'j:/domains', 'win32', undefined],
    ['j:/other/**', 'j:/domains', 'win32', undefined],
    ['j:/domainsx/**', 'j:/domains', 'win32', undefined],
    ['/srv/**', '/srv/root', 'linux', undefined],
    // The root itself is never an ignore.
    ['j:/domains', 'j:/domains', 'win32', undefined],
  ] as const)('%s under %s (%s) -> %s', (pattern, root, platform, expected) => {
    expect(rootRelativeIgnore(pattern, root, platform)).toBe(expected);
  });
});

describe('parcelIgnore', () => {
  it("always holds the root's .git (D152), first", () => {
    expect(parcelIgnore([], '/srv/root', 'linux')).toEqual(['.git']);
    expect(
      parcelIgnore(
        ['**/node_modules/**', '/srv/root/tmp/**', '/elsewhere/**'],
        '/srv/root',
        'linux',
      ),
    ).toEqual(['.git', '**/node_modules/**', 'tmp/**']);
  });

  it('defaults to the running platform', () => {
    expect(parcelIgnore(['a/**'], process.cwd())).toEqual(['.git', 'a/**']);
  });
});
