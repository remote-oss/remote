import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';

/** The run's HOME for the ssh-pack launches, as the launch gives it to the editor. */
export function packHome(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'home-pack');
}

/** The two lines of the client's SSH configuration the rows write: a host and its name. */
const CONFIG_LINES = ['Host f2007-local', '  HostName f2007-local.invalid'];

/** Writes the client's `~/.ssh/config` as the two-line file the rows read, and gives its path. */
export function writeClientSshConfig(): string {
  const file = path.join(packHome(), '.ssh', 'config');
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${CONFIG_LINES.join('\n')}\n`);
  return file;
}
