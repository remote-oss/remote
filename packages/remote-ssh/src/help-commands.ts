/**
 * @fileoverview The four help commands and the issue reporter. Each runs the same editor operation every time and
 * keeps no state: the three addresses are the ones the manifest's remote help names, and the settings filter names
 * the extension first and then its pack in pack order.
 */

import type {CommandHandler} from 'lib-identifiers';

/** The addresses of the manifest's `remoteHelp`; the commands open exactly these. */
export interface HelpLinks {
  documentation: string;
  getStarted: string;
  feedback: string;
}

/** The extension the commands speak for. */
export interface HelpExtension {
  id: string;
  /** The ids of its `extensionPack`, in order. */
  pack: readonly string[];
}

/** The editor operations the help commands need. */
export interface HelpEditor {
  openExternal(address: string): PromiseLike<unknown>;
  openSettings(filter: string): PromiseLike<unknown>;
  openIssueReporter(extensionId: string): PromiseLike<unknown>;
}

/** The commands this module serves, by their names in the identifier table. */
export interface HelpHandlers {
  getHelp: CommandHandler;
  getStarted: CommandHandler;
  provideFeedback: CommandHandler;
  settings: CommandHandler;
  reportIssue: CommandHandler;
}

/** The filter of the settings editor: `@ext:` and the extension and its pack, comma-separated without spaces. */
function settingsFilter(extension: HelpExtension): string {
  return `@ext:${[extension.id, ...extension.pack].join(',')}`;
}

/** The handlers of the help commands over `editor`. */
export function helpHandlers(
  editor: HelpEditor,
  links: HelpLinks,
  extension: HelpExtension,
): HelpHandlers {
  return {
    getHelp: {execute: () => editor.openExternal(links.documentation)},
    getStarted: {execute: () => editor.openExternal(links.getStarted)},
    provideFeedback: {execute: () => editor.openExternal(links.feedback)},
    settings: {
      execute: () => editor.openSettings(settingsFilter(extension)),
    },
    reportIssue: {execute: () => editor.openIssueReporter(extension.id)},
  };
}
