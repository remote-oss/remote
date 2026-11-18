/**
 * @fileoverview The CLI-source editor of a run: a copy of the run's VSCodium whose `product.json` names a
 * `cliDownloadUrlTemplate` on the run's download host, the synthetic profile of ADR-0006 decision 8. Only the copy's
 * `product.json` differs from the editor; no other launch starts the copy.
 */

import {readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner} from './command-runner.ts';

/**
 * The path, after the download host's base, that the copy's template names. VSCodium bakes its release into its
 * templates, so only `${os}`, `${arch}` and `${commit}` remain; the download host serves `/cli/<os>-<arch>/...` from the
 * run's pins, or a stand-in archive where it has none, whatever follows the platform, and the commit in the path tells a
 * row which commit the client asked for.
 */
export const CLI_TEMPLATE_PATH =
  '/cli/${os}-${arch}/${commit}/cli-${os}-${arch}.tar.gz';

/** The file where the stand-in CLI writes the path it was run as, on the host. */
export const STAND_IN_CLI_TRACE = '/tmp/stand-in-cli-ran';

/**
 * The name of the stand-in CLI's file inside its archive: the CLI's name in an archive is the product's
 * `applicationName`, which the install unpacks by, and the VSCodium build of the harness names it so.
 */
export const STAND_IN_CLI_NAME = 'codium-insiders';

/**
 * What the stand-in CLI archive of a run holds: one script that writes the path it was run as to `STAND_IN_CLI_TRACE`
 * and fails. The install that fails on it removes the file it was copied to, so the trace is what a row reads on the
 * host to tell that the archive's file reached the server folder and was run from there.
 */
export const STAND_IN_CLI_SCRIPT = `#!/bin/sh\n# the stand-in CLI of the acceptance run\necho "$0" > ${STAND_IN_CLI_TRACE}\nexit 1\n`;

/** The `applicationName` the `product.json` of the editor whose executable is `executable` names; none when it has none. */
export function applicationNameOf(executable: string): string | undefined {
  try {
    const {applicationName} = JSON.parse(
      readFileSync(productFileOf(executable), 'utf8'),
    ) as {applicationName?: unknown};
    return typeof applicationName === 'string' && applicationName !== ''
      ? applicationName
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why the stand-in CLI would not be unpacked as the CLI of the editor at `executable`: the product names its CLI by
 * another name than the stand-in's file; none when the names agree or the product names none.
 */
export function standInNameProblem(executable: string): string | undefined {
  const name = applicationNameOf(executable);
  return name === undefined || name === STAND_IN_CLI_NAME
    ? undefined
    : `the editor's applicationName is ${name}, and the stand-in CLI's file is named ${STAND_IN_CLI_NAME}: the install unpacks the CLI by the product's name`;
}

/** The folder of the copy in the run's folder. */
export const CLI_EDITOR_FOLDER = 'cli-editor';

/** The text of a `product.json` with `cliDownloadUrlTemplate` set to `template`, and every other field as it was. */
export function withCliTemplate(productText: string, template: string): string {
  const product = JSON.parse(productText) as Record<string, unknown>;
  return `${JSON.stringify({...product, cliDownloadUrlTemplate: template}, null, '\t')}\n`;
}

/** The `product.json` of the editor whose executable is `executable`. */
export function productFileOf(executable: string): string {
  return path.join(
    path.dirname(executable),
    'resources',
    'app',
    'product.json',
  );
}

/** The commit the `product.json` of the editor whose executable is `executable` names; none when it has no readable one. */
export function commitOfEditor(executable: string): string | undefined {
  try {
    const {commit} = JSON.parse(
      readFileSync(productFileOf(executable), 'utf8'),
    ) as {commit?: unknown};
    return typeof commit === 'string' && commit !== '' ? commit : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Makes the CLI-source copy of the editor at `executable` in `<runFolder>/cli-editor` and gives the copy's executable:
 * the editor's folder linked file by file (`cp -al`), or copied where a link can't reach the run's folder, then the
 * copy's `product.json` unlinked and written anew, so the editor's own file is never written through a link.
 */
export function cliSourceEditorOf(
  command: CommandRunner,
  executable: string,
  runFolder: string,
  template: string,
): string {
  const folder = path.join(runFolder, CLI_EDITOR_FOLDER);
  rmSync(folder, {recursive: true, force: true});
  const source = path.dirname(executable);
  if (command('cp', ['-al', source, folder]).status !== 0) {
    rmSync(folder, {recursive: true, force: true});
    checked(command, 'cp', ['-a', source, folder]);
  }
  const copy = path.join(folder, path.basename(executable));
  const productFile = productFileOf(copy);
  const productText = readFileSync(productFile, 'utf8');
  unlinkSync(productFile);
  writeFileSync(productFile, withCliTemplate(productText, template));
  return copy;
}
