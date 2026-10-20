/**
 * @fileoverview What the rows of Open Web UI share: the browser that records the addresses it is asked to open, and the
 * port of the server the connect logs.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {userSettingsFile, variable} from './harness.ts';

/** The folder of the run's recording browser, which the launch puts first on the editor's PATH. */
function browserFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'browser-bin');
}

/** The file the recording browser appends to. */
function urlsFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'browser-urls');
}

/** Writes the recording `xdg-open` and forgets the addresses it recorded. */
export function installBrowser(): void {
  mkdirSync(browserFolder(), {recursive: true});
  const program = path.join(browserFolder(), 'xdg-open');
  writeFileSync(
    program,
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$(dirname "$0")/../browser-urls"\n',
  );
  chmodSync(program, 0o755);
  rmSync(urlsFile(), {force: true});
}

/** The addresses the browser was asked to open, in order. */
export function openedUrls(): string[] {
  return existsSync(urlsFile())
    ? readFileSync(urlsFile(), 'utf8')
        .split('\n')
        .filter(line => line !== '')
    : [];
}

/** The port of the server the connect last logged, or nothing when it logged none. */
export function serverPortOf(lines: readonly string[]): number | undefined {
  const ports = lines.flatMap(line => {
    const match = /^Remote server listening on port (\d+)$/.exec(line);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  return ports.at(-1);
}

/** The key the command's palette entry depends on, which no manifest contributes. */
const WEB_ACCESS = 'remote.SSH.enableWebAccess';

/** Sets the key in the run's user settings, or removes it when `value` is `undefined`, and waits a second for the editor to read it. */
export async function setWebAccess(value: unknown): Promise<void> {
  const file = userSettingsFile();
  const current = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : {};
  const rest = Object.fromEntries(
    Object.entries(current).filter(([key]) => key !== WEB_ACCESS),
  );
  writeFileSync(
    file,
    JSON.stringify(
      value === undefined ? rest : {...rest, [WEB_ACCESS]: value},
      null,
      2,
    ),
  );
  await new Promise(resolve => setTimeout(resolve, 1000));
}
