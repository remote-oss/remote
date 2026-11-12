/**
 * @fileoverview The four help commands: Help, Get Started and Provide Feedback open their address and do nothing else;
 * Report Issue opens the editor's own issue reporter for this extension with the text that asks for the log. Each runs
 * the same operation every time and keeps no state.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';

/** The addresses the commands open, the same ones the manifest's `remoteHelp` names. */
export const HELP_LINKS = {
  documentation:
    'https://github.com/remote-oss/remote/tree/main/docs/remote-containers',
  getStarted:
    'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md',
  feedback: 'https://github.com/remote-oss/remote/issues/new/choose',
} as const;

/** The editor's command that opens its issue reporter. */
export const ISSUE_REPORTER_COMMAND = 'workbench.action.openIssueReporter';

/** What the issue reporter is opened with: the extension it reports on and the text of its description field. */
export interface IssueReport {
  extensionId: string;
  issueBody: string;
}

/** The editor operations the help commands need. */
export interface HelpEditor {
  openExternal(address: string): PromiseLike<unknown>;
  /** Runs the issue reporter's command; it rejects when the editor has no such command. */
  openIssueReporter(report: IssueReport): PromiseLike<unknown>;
}

/** The commands this module serves, by their names in the identifier table. */
export interface HelpHandlers {
  getHelp: CommandHandler;
  getStarted: CommandHandler;
  provideFeedback: CommandHandler;
  reportIssue: CommandHandler;
}

/** The handlers of the help commands over `editor`; `issueBody` is the text the reporter's description starts with. */
export function helpHandlers(
  editor: HelpEditor,
  extensionId: string,
  issueBody: string,
  logger: Logger,
): HelpHandlers {
  return {
    getHelp: {execute: () => editor.openExternal(HELP_LINKS.documentation)},
    getStarted: {execute: () => editor.openExternal(HELP_LINKS.getStarted)},
    provideFeedback: {execute: () => editor.openExternal(HELP_LINKS.feedback)},
    reportIssue: {
      execute: async () => {
        try {
          await editor.openIssueReporter({extensionId, issueBody});
        } catch (caught) {
          logger.warn(
            `the issue reporter could not be opened: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        }
      },
    },
  };
}
