/**
 * @fileoverview The argument lists of the git calls a clone makes, the only way a source reaches git: the source is
 * one element after `--`, never inside a shell string, and a source from a link may only use the allowed protocols.
 */

import {
  type CloneOrigin,
  type CloneSource,
  LINK_PROTOCOL_ALLOW,
} from './clone-source.ts';

/** The `-c` options that pin the protocols of a source from a link; none for a typed source. */
function protocolOptions(origin: CloneOrigin): string[] {
  return origin === 'link'
    ? [
        '-c',
        'protocol.allow=never',
        ...LINK_PROTOCOL_ALLOW.flatMap(protocol => [
          '-c',
          `protocol.${protocol}.allow=always`,
        ]),
      ]
    : [];
}

/** The access pre-check on the host: `git ls-remote` of the repository part, its refs only. */
export function lsRemoteArguments(
  source: CloneSource,
  origin: CloneOrigin,
): string[] {
  return [...protocolOptions(origin), 'ls-remote', '--', source.urlToClone];
}

/** What the clone in the bootstrap takes of a source. */
export type CloneRequest = Pick<CloneSource, 'urlToClone' | 'ref' | 'commit'>;

/** The depth git reads as the whole history, for a fetch that works on shallow and complete repositories alike. */
const WHOLE_HISTORY = 2147483647;

/** A git call in the bootstrap container, with no terminal prompt for credentials it can't answer. */
function gitInContainer(container: string, gitArguments: string[]): string[] {
  return [
    'exec',
    '--env',
    'GIT_TERMINAL_PROMPT=0',
    container,
    'git',
    ...gitArguments,
  ];
}

/** The shallow clone into `folder`, with every branch's tip; a branch or tag ref is cloned as it, a commit later. */
export function cloneArguments(
  container: string,
  request: CloneRequest,
  origin: CloneOrigin,
  folder: string,
): string[] {
  const branch =
    request.ref === undefined || request.commit === true
      ? []
      : [`--branch=${request.ref}`];
  return gitInContainer(container, [
    ...protocolOptions(origin),
    'clone',
    '--depth=1',
    '--no-single-branch',
    ...branch,
    '--',
    request.urlToClone,
    folder,
  ]);
}

/** The fetch of a commit's SHA into the clone at `folder`. */
export function commitFetchArguments(
  container: string,
  commitSha: string,
  origin: CloneOrigin,
  folder: string,
): string[] {
  return gitInContainer(container, [
    ...protocolOptions(origin),
    '-C',
    folder,
    'fetch',
    '--depth=1',
    'origin',
    commitSha,
  ]);
}

/** The checkout of a fetched commit, as a detached HEAD. */
export function commitCheckoutArguments(
  container: string,
  commitSha: string,
  folder: string,
): string[] {
  return gitInContainer(container, [
    '-C',
    folder,
    'checkout',
    '--detach',
    commitSha,
  ]);
}

/** The fetch of the whole history and every tag into the shallow clone at `folder`. */
export function deepenArguments(
  container: string,
  origin: CloneOrigin,
  folder: string,
): string[] {
  return gitInContainer(container, [
    ...protocolOptions(origin),
    '-C',
    folder,
    'fetch',
    `--depth=${String(WHOLE_HISTORY)}`,
    '--tags',
    'origin',
  ]);
}
