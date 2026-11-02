/**
 * @fileoverview The editor behind the resolver host: the one module of the host that touches `vscode`. It is only
 * imported for its types, so it loads without the editor, and the editor's classes and enums are taken from the
 * `editor` it is given.
 */

import type * as vscode from 'vscode';
import type {
  EditorResolver,
  ProgressPort,
  ResolvedConnection,
  ResolverEditor,
} from './host.ts';
import {phaseMessage} from './progress-message.ts';

/** What the extension decides about its editor adapter. */
export interface ResolverEditorOptions {
  /** The command the progress's "(details)" link runs; registered by the extension, never contributed. */
  detailsCommand: string;
  /** The tooltip of the "(details)" link as it is now, read at each report; none keeps the editor's own. */
  detailsTitle?: () => string | undefined;
  /** The source of the window's candidate ports that the resolver declares to the editor; none keeps the editor's default. */
  candidatePortSource?: 'output';
}

/** The editor's result for a resolved connection: its address, with the options and tunnel facts set on it. */
function resultOf(
  editor: typeof vscode,
  connection: ResolvedConnection,
): vscode.ResolverResult {
  const result: vscode.ResolverResult = Object.assign(
    new editor.ResolvedAuthority(
      connection.host,
      connection.port,
      connection.connectionToken,
    ),
    {
      extensionHostEnv: {...connection.extensionHostEnv},
      environmentTunnels: [
        ...connection.environmentTunnels,
      ] as vscode.TunnelDescription[],
    },
  );
  if (connection.isTrusted !== undefined) {
    result.isTrusted = connection.isTrusted;
  }
  return result;
}

/**
 * The resolver the editor calls: each resolve through the host. It gives the editor no tunnel factory and no tunnel
 * features: core then builds the window's forwards itself, through the server connection, with its own defaults
 * (the host-side connection of a forwarded port is the server's). When the extension declares one, it also gives the
 * source of the window's candidate ports.
 */
function editorResolverOf(
  editor: typeof vscode,
  resolver: EditorResolver,
  options: ResolverEditorOptions,
): vscode.RemoteAuthorityResolver {
  const editorResolver: vscode.RemoteAuthorityResolver = {
    resolve: async (authority, context) =>
      resultOf(editor, await resolver.resolve(authority, context)),
  };
  if (options.candidatePortSource === 'output') {
    editorResolver.candidatePortSource = editor.CandidatePortSource.Output;
  }
  const {canonicalPath} = resolver;
  if (canonicalPath !== undefined) {
    editorResolver.getCanonicalURI = async uri => {
      if (uri.scheme !== 'vscode-remote') {
        return undefined;
      }
      const local = await canonicalPath(uri.authority, uri.path);
      return local === undefined ? undefined : editor.Uri.file(local);
    };
  }
  return editorResolver;
}

/** The progress of a connect as a notification, with the details link in front of each stage that has it. */
function progressOf(
  editor: typeof vscode,
  options: ResolverEditorOptions,
): ProgressPort {
  return {
    withProgress: (request, task) =>
      Promise.resolve(
        editor.window.withProgress(
          {
            location: editor.ProgressLocation.Notification,
            title: request.title,
            cancellable: request.cancellable,
          },
          async (progress, token) => {
            const cancelled = token.onCancellationRequested(() => {
              cancelled.dispose();
              request.onCancel();
            });
            try {
              return await task((text, details, increment) => {
                progress.report({
                  message: phaseMessage(
                    text,
                    details,
                    options.detailsCommand,
                    options.detailsTitle?.(),
                  ),
                  ...(increment === undefined ? {} : {increment}),
                });
              });
            } finally {
              cancelled.dispose();
            }
          },
        ),
      ),
  };
}

/** The window's workspace file, else its first folder, as a URI string; nothing for a window without either. */
function workspaceOf(editor: typeof vscode): string | undefined {
  const workspace =
    editor.workspace.workspaceFile ??
    editor.workspace.workspaceFolders?.[0]?.uri;
  return workspace?.toString();
}

/** The resolver host's view of the editor. */
export function resolverEditorOf(
  editor: typeof vscode,
  options: ResolverEditorOptions,
): ResolverEditor {
  return {
    registerRemoteAuthorityResolver: (authorityPrefix, resolver) =>
      editor.workspace.registerRemoteAuthorityResolver(
        authorityPrefix,
        editorResolverOf(editor, resolver, options),
      ),
    progress: progressOf(editor, options),
    startTimer: (milliseconds, callback) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
    notAvailable: (message, handled) =>
      editor.RemoteAuthorityResolverError.NotAvailable(message, handled),
    temporarilyNotAvailable: message =>
      editor.RemoteAuthorityResolverError.TemporarilyNotAvailable(message),
    windowId: () => editor.env.sessionId,
    windowWorkspace: () => workspaceOf(editor),
    reloadWindow: () =>
      editor.commands.executeCommand('workbench.action.reloadWindow'),
    closeRemote: () =>
      editor.commands.executeCommand('workbench.action.remote.close'),
  };
}
