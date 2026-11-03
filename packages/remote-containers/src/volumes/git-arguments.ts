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
