/**
 * @fileoverview The write of a template into a folder: the CLI applies it into a scratch folder of ours, and this copy
 * adds or replaces files in the target and never removes one. A file that exists is asked about before anything is
 * written, and a failure leaves nothing partial.
 */

import path from 'node:path';
import type {TemplateRequest} from '../cli/cli-arguments.ts';
import type {ApplyTemplateResult, CliFailure} from '../cli/cli-lines.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English templates of the texts of the write. */
const WRITE_TEMPLATES = {
  progress: 'Adding Dev Container Configuration Files...',
  applyFailed: 'Application of the template failed.',
  cancel: 'Cancel',
  showLog: 'Show Log',
  overwritePrompt: "File '{0}' already exists, overwrite?",
  overwrite: 'Overwrite',
  skip: 'Skip',
  unsavedChangesNote: 'It has unsaved changes in an editor.',
  configurationNotWritten: "The configuration couldn't be written to {0}: {1}",
} as const;

/** What the write is asked to do: the template, its options and Features, and the folder to write into. */
export interface WriteRequest {
  targetFolder: string;
  templateId: string;
  templateArgs: TemplateRequest['templateArgs'];
  features: TemplateRequest['features'];
  omitPaths: readonly string[];
}

/** How the write ended. */
export type WriteOutcome =
  /** The target-relative paths actually written. */
  | {kind: 'written'; files: string[]}
  /** The user cancelled a question about an existing file: nothing was written. */
  | {kind: 'cancelled'}
  /** Nothing was written. */
  | {kind: 'failed'; detail: string};

/** What an entry of the file system is. */
export type EntryKind = 'file' | 'folder' | 'missing';

/** The file system the write uses. */
interface WriteFiles {
  /** A new folder under the extension's storage, for one run. */
  makeScratchFolder(): Promise<string>;
  /** What is at the path. */
  kindOf(file: string): Promise<EntryKind>;
  read(file: string): Promise<Uint8Array>;
  /** Writes the bytes, replacing the file. */
  write(file: string, bytes: Uint8Array): Promise<void>;
  /** Creates the folder and the ones above it that are missing. */
  makeFolder(folder: string): Promise<void>;
  /** Removes the folder and what is in it; none if it is not there. */
  removeFolder(folder: string): Promise<void>;
  /** Why files could not be created in the folder (it may not exist yet): the file system's words; none when they can. */
  creationProblem(folder: string): Promise<string | undefined>;
}

/** The modal dialogs of the write. */
interface WriteDialogs {
  /** Shows a modal with the buttons; gives the one chosen, or nothing for Escape. */
  show(
    severity: 'error' | 'warning',
    message: string,
    detail: string,
    buttons: readonly string[],
  ): Promise<string | undefined>;
  revealLog(): void;
}

/** What the write needs of its surroundings. */
export interface WritePorts {
  applyTemplate(
    request: TemplateRequest,
    onLine: (line: string) => void,
    cancellation: AbortSignal,
  ): Promise<ApplyTemplateResult>;
  files: WriteFiles;
  dialogs: WriteDialogs;
  /** Whether an open editor holds unsaved changes of the file. */
  hasUnsavedChanges(file: string): boolean;
  /** Shows an indeterminate notification with no buttons for as long as `work` takes. */
  withProgress<Result>(
    title: string,
    work: () => Promise<Result>,
  ): Promise<Result>;
  /** Writes a line to the Dev Containers log. */
  logLine(line: string): void;
  translate: Translate;
}

/** The words of a failure of the CLI. */
function detailOf(failure: Exclude<CliFailure, {kind: 'cancelled'}>): string {
  switch (failure.kind) {
    case 'noResult':
      return `the CLI gave no result (exit status ${String(failure.status)})`;
    case 'malformedResult':
      return `the CLI's result has no valid ${failure.field}`;
    default:
      return failure.message;
  }
}

/** The scratch-relative path of a file the CLI reports, without a leading `./`. */
function relativeOf(reported: string): string {
  return reported.replace(/^\.\//, '');
}

/** Applies the template into a scratch folder, plans the copy with the questions, and writes. */
export async function writeTemplate(
  request: WriteRequest,
  ports: WritePorts,
  cancellation: AbortSignal,
): Promise<WriteOutcome> {
  const {files, dialogs, translate} = ports;
  function text(template: string, values: readonly string[] = []): string {
    return filled(translate, template, values);
  }

  /** Asks about the existing files, all before anything is written; none to write for Cancel. */
  async function plan(
    reported: readonly string[],
  ): Promise<string[] | 'cancelled'> {
    const chosen: string[] = [];
    for (const relative of reported.map(relativeOf)) {
      const target = path.join(request.targetFolder, relative);
      if ((await files.kindOf(target)) !== 'file') {
        chosen.push(relative);
        continue;
      }
      const answer = await dialogs.show(
        'warning',
        text(WRITE_TEMPLATES.overwritePrompt, [`./${relative}`]),
        ports.hasUnsavedChanges(target)
          ? text(WRITE_TEMPLATES.unsavedChangesNote)
          : '',
        [
          text(WRITE_TEMPLATES.overwrite),
          text(WRITE_TEMPLATES.cancel),
          text(WRITE_TEMPLATES.skip),
        ],
      );
      if (answer === text(WRITE_TEMPLATES.overwrite)) {
        chosen.push(relative);
      } else if (answer !== text(WRITE_TEMPLATES.skip)) {
        return 'cancelled';
      }
    }
    return chosen;
  }

  /** Why a folder the copy needs cannot be made, as the user is told, or none when all can. */
  async function problemOf(
    relatives: readonly string[],
  ): Promise<string | undefined> {
    for (const relative of relatives) {
      const folder = path.dirname(path.join(request.targetFolder, relative));
      const problem = await files.creationProblem(folder);
      if (problem !== undefined) {
        return problem;
      }
    }
    return undefined;
  }

  return ports.withProgress(text(WRITE_TEMPLATES.progress), async () => {
    const scratch = await files.makeScratchFolder();
    try {
      const applied = await ports.applyTemplate(
        {
          workspaceFolder: scratch,
          templateId: request.templateId,
          templateArgs: request.templateArgs,
          features: request.features,
          omitPaths: request.omitPaths,
        },
        line => {
          ports.logLine(line);
        },
        cancellation,
      );
      if (applied.kind === 'cancelled') {
        return {kind: 'cancelled'};
      }
      if (applied.kind !== 'applied') {
        const answer = await dialogs.show(
          'error',
          text(WRITE_TEMPLATES.applyFailed),
          '',
          [text(WRITE_TEMPLATES.cancel), text(WRITE_TEMPLATES.showLog)],
        );
        if (answer === text(WRITE_TEMPLATES.showLog)) {
          dialogs.revealLog();
        }
        return {kind: 'failed', detail: detailOf(applied)};
      }
      const planned = await plan(applied.files);
      if (planned === 'cancelled') {
        return {kind: 'cancelled'};
      }
      const problem = await problemOf(planned);
      if (problem !== undefined) {
        await dialogs.show(
          'error',
          text(WRITE_TEMPLATES.configurationNotWritten, [
            request.targetFolder,
            problem,
          ]),
          '',
          [],
        );
        return {kind: 'failed', detail: problem};
      }
      try {
        for (const relative of planned) {
          const target = path.join(request.targetFolder, relative);
          await files.makeFolder(path.dirname(target));
          await files.write(
            target,
            await files.read(path.join(scratch, relative)),
          );
        }
      } catch (caught) {
        const detail = (caught as Error).message;
        await dialogs.show(
          'error',
          text(WRITE_TEMPLATES.configurationNotWritten, [
            request.targetFolder,
            detail,
          ]),
          '',
          [],
        );
        return {kind: 'failed', detail};
      }
      return {kind: 'written', files: planned};
    } finally {
      await files.removeFolder(scratch);
    }
  });
}
