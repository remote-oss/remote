/**
 * @fileoverview The README of the Remote - SSH package (card connect-138): the sections it holds, and the
 * phrases each of them pins, so the wording can move around them.
 */
import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

/** The README of the package. */
const README = readFileSync(path.join(PACKAGE, 'README.md'), 'utf8');

/** The sections of the README by heading: the text under each `## ` heading. */
const SECTIONS: Record<string, string> = (() => {
  const found: Record<string, string> = {};
  for (const part of README.split('\n## ').slice(1)) {
    const newline = part.indexOf('\n');
    found[part.slice(0, newline).trim()] = part.slice(newline + 1);
  }
  return found;
})();

/** The section of the README under the heading `name`; it fails naming the heading when the section is absent. */
function section(name: string): string {
  const text = SECTIONS[name];
  if (text === undefined) {
    throw new Error(`the README has no section ${name}`);
  }
  return text;
}

describe('the README', () => {
  it('F-3904 B-4: the Installing section names the Open VSX id and the releases page link', () => {
    deepStrictEqual(
      [
        section('Installing').includes('remote-oss.remote-ssh'),
        section('Installing').includes(
          'https://github.com/remote-oss/remote/releases',
        ),
      ],
      [true, true],
    );
  });

  it('F-3904 B-4: the Installing section names the two companions by id and says the editor bundles them only from Open VSX', () => {
    deepStrictEqual(
      [
        section('Installing').includes('remote-oss.remote-ssh-edit'),
        section('Installing').includes('remote-oss.remote-explorer'),
        section('Installing').includes('only from Open VSX'),
      ],
      [true, true, true],
    );
  });

  it('F-3904 B-4: the Updates section says a VSIX install gets no automatic updates, and a newer one is installed by hand', () => {
    deepStrictEqual(
      [
        section('Updates').includes('no automatic updates'),
        section('Updates').includes('by hand'),
      ],
      [true, true],
    );
  });

  it('F-3904 B-4: the Uninstalling and disabling section says both companions go with the extension', () => {
    deepStrictEqual(
      [
        section('Uninstalling and disabling').includes(
          'uninstalls both companions',
        ),
        section('Uninstalling and disabling').includes('disables both'),
      ],
      [true, true],
    );
  });

  it('F-3904 B-4: the One at a time section says only one ssh-remote extension may be enabled', () => {
    deepStrictEqual(
      [
        section('One at a time').includes('Only one extension'),
        section('One at a time').includes('ssh-remote'),
      ],
      [true, true],
    );
  });

  it('F-3904 B-4: the proposed API section holds the argv.json text with the extension id, and the restart', () => {
    deepStrictEqual(
      [
        section('The proposed API').includes('"enable-proposed-api"'),
        section('The proposed API').includes('"remote-oss.remote-ssh"'),
        section('The proposed API').includes('restart'),
      ],
      [true, true, true],
    );
  });
});
