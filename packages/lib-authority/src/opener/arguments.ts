/**
 * @fileoverview The editor commands the window opener hands to core: open a remote or local folder, or open an
 * empty window, in the current or a new window.
 */

/** How the opener was told the path is: a folder, or a workspace file (never guessed). */
export type PathKind = 'folder' | 'workspace';

/** Where the opener opens: the calling window, or exactly one new window. */
export type OpenTarget = 'current' | 'new';

/** The core commands the opener can hand to the editor, in the shape core executes them. */
export type OpenCommand =
  | {
      command: 'vscode.openFolder';
      uri: {scheme: 'vscode-remote'; authority: string; path: string};
      options: {forceNewWindow: boolean; forceReuseWindow: boolean};
    }
  | {
      command: 'vscode.newWindow';
      options: {remoteAuthority: string | null; reuseWindow: boolean};
    }
  | {
      command: 'vscode.openFolder';
      uri: {scheme: 'file'; path: string};
      options: {
        forceNewWindow: boolean;
        forceReuseWindow: boolean;
        forceLocalWindow: true;
      };
    };

/**
 * The command for a remote target: a folder or workspace file as a vscode-remote uri, or an empty window with
 * the authority when no path is given. `pathKind` is passed through as told; both kinds use the same command.
 */
export function openRemoteCommand(
  authority: string,
  path: string | undefined,
  pathKind: PathKind,
  target: OpenTarget,
): OpenCommand {
  const forceNewWindow = target === 'new';
  if (path === undefined) {
    return {
      command: 'vscode.newWindow',
      options: {remoteAuthority: authority, reuseWindow: !forceNewWindow},
    };
  }
  return {
    command: 'vscode.openFolder',
    uri: {scheme: 'vscode-remote', authority, path},
    options: {forceNewWindow, forceReuseWindow: !forceNewWindow},
  };
}

/**
 * The command for a local target: a file-scheme folder that reaches a local window by `forceLocalWindow`, or an
 * empty local window; an empty window says `remoteAuthority: null`, because an absent authority would open the
 * current window's authority.
 */
export function openLocalCommand(
  path: string | undefined,
  pathKind: PathKind,
  target: OpenTarget,
): OpenCommand {
  const forceNewWindow = target === 'new';
  if (path === undefined) {
    return {
      command: 'vscode.newWindow',
      options: {remoteAuthority: null, reuseWindow: !forceNewWindow},
    };
  }
  return {
    command: 'vscode.openFolder',
    uri: {scheme: 'file', path},
    options: {
      forceNewWindow,
      forceReuseWindow: !forceNewWindow,
      forceLocalWindow: true,
    },
  };
}
