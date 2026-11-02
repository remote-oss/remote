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
 * templates, so only `${os}` and `${arch}` remain; the download host serves `/cli/<os>-<arch>/` from the run's pins.
 */
export const CLI_TEMPLATE_PATH = '/cli/${os}-${arch}/cli-${os}-${arch}.tar.gz';

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
