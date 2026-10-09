/**
 * @fileoverview The resource label formatter of a window's remote authority: how the editor writes a path and the
 * suffix after a workspace name for resources on the remote side. The editor keeps the formatters it is given and
 * applies them in later windows, so a formatter is registered once, when the authority has resolved.
 */

import type {DecodedTarget} from '../codecs/types.ts';

/** The scheme of every resource on a remote side. */
const REMOTE_SCHEME = 'vscode-remote';

/** How the editor writes a resource on the remote side, and the suffix after a workspace name. */
export interface ResourceLabelFormatter {
  scheme: string;
  authority: string;
  formatting: {
    label: string;
    separator: '/';
    tildify: boolean;
    normalizeDriveLetter: boolean;
    workspaceSuffix: string;
  };
}

/** What the editor offers for registering a formatter: the member of its `workspace` namespace. */
export interface LabelFormatterHost {
  registerResourceLabelFormatter(formatter: ResourceLabelFormatter): {
    dispose(): void;
  };
}

/**
 * Registers the formatter of a decoded authority. It applies to exactly the authority as the window carries it (the
 * family and the payload as written, never re-encoded), writes paths with `/` and `~` for the home folder, and puts
 * `suffix` after workspace names. The caller composes the suffix from the family's own host label and its string
 * table.
 */
export function registerAuthorityLabel(
  host: LabelFormatterHost,
  decoded: DecodedTarget,
  suffix: string,
): {dispose(): void} {
  return host.registerResourceLabelFormatter({
    scheme: REMOTE_SCHEME,
    authority: `${decoded.family}+${decoded.rawHostString}`,
    formatting: {
      label: '${path}',
      separator: '/',
      tildify: true,
      normalizeDriveLetter: true,
      workspaceSuffix: suffix,
    },
  });
}
