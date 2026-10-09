/**
 * @fileoverview The editor's API seen through the narrow interface the probes read. The module is only imported for
 * its types, so it loads without the editor, and every member is read when a probe asks, not when the adapter is made.
 */

import type * as vscode from 'vscode';
import type {ProbeApi} from './probe.ts';

/** The probes' view of the editor's API, reading each guarded member at the moment it is asked for. */
export function probeApiOf(editor: typeof vscode): ProbeApi {
  return {
    get remoteAuthority() {
      return editor.env.remoteAuthority;
    },
    get tunnels() {
      return editor.workspace.tunnels;
    },
    onDidWriteTerminalData: listener =>
      editor.window.onDidWriteTerminalData(listener),
    getCommands: filterInternal => editor.commands.getCommands(filterInternal),
  };
}
