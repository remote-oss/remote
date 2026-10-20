/**
 * @fileoverview Refuses an acceptance run whose packaged extensions are older than the sources they are built from, so
 * that a VSIX left in `dist/` from an earlier checkout is never the one under test. The sources are the files under
 * `packages/` that git tracks or would track, without the tests.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';

/** A file and the time it last changed, in milliseconds. */
export interface Changed {
  file: string;
  changedAt: number;
}

/** Whether a file under `packages/` goes into a package: its tests and the coverage records don't. */
export function isPackagedSource(file: string): boolean {
  const parts = file.split('/');
  return (
    parts[0] === 'packages' &&
    !parts.includes('test') &&
    parts.at(-1) !== 'coverage.json'
  );
}

/** The files under `root`'s `packages/` that git tracks or would track and that go into a package, with their times. */
export function packagedSources(root: string): Changed[] {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'packages',
    ],
    {cwd: root, encoding: 'utf8'},
  );
  return listed
    .split('\0')
    .filter(file => file !== '' && isPackagedSource(file))
    .map(file => path.join(root, file))
    .filter(file => existsSync(file))
    .map(file => ({file, changedAt: statSync(file).mtimeMs}));
}

/** Why the run refuses: the first VSIX older than the newest source, named with it, or nothing when none is. */
export function staleProblem(
  vsixFiles: readonly Changed[],
  sources: readonly Changed[],
): string | undefined {
  const newest = sources.reduce<Changed | undefined>(
    (found, each) =>
      found === undefined || each.changedAt > found.changedAt ? each : found,
    undefined,
  );
  if (newest === undefined) {
    return undefined;
  }
  const stale = vsixFiles.find(vsix => vsix.changedAt < newest.changedAt);
  return stale === undefined
    ? undefined
    : `${stale.file} is older than ${newest.file}: run \`pnpm package\` first (\`pnpm test:acceptance:vscodium\` packages before it runs)`;
}

/** `changed` with its file named relative to `root`. */
function relativeTo(root: string, changed: Changed): Changed {
  return {...changed, file: path.relative(root, changed.file)};
}

/** The refusal for `root`'s run with `vsixFiles`, the packaged extensions it would install, or nothing; paths are `root`'s. */
export function staleRefusal(
  root: string,
  vsixFiles: readonly string[],
): string | undefined {
  return staleProblem(
    vsixFiles.map(file =>
      relativeTo(root, {file, changedAt: statSync(file).mtimeMs}),
    ),
    packagedSources(root).map(each => relativeTo(root, each)),
  );
}
