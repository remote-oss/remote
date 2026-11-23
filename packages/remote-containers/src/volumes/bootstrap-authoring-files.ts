/**
 * @fileoverview The authoring files of a clone in a volume while its window isn't connected yet: the wizard reads and
 * writes the clone's folder inside the bootstrap container, each call a `docker exec` read by its exit status. Content
 * crosses as base64, so a file's bytes arrive unchanged; a listing comes back with our own markers.
 */

import type {RootEntry} from '../authoring/curated-templates.ts';
import type {AuthoringFiles, EntryKind} from '../authoring/window-files.ts';
import {type EngineStepPorts, stepOf} from './engine-step.ts';

/** Lists a folder: each entry as its kind's letter, a slash and its name, ended by NUL; nothing for a missing folder. */
const LIST_SCRIPT = [
  'cd "$0" 2>/dev/null || exit 0',
  'for entry in * .[!.]* ..?*; do',
  '[ -e "$entry" ] || [ -L "$entry" ] || continue',
  'if [ -d "$entry" ]; then kind=d; elif [ -f "$entry" ]; then kind=f; else kind=o; fi',
  'printf "%s/%s\\0" "$kind" "$entry"',
  'done',
].join('\n');

/** Exits 0 when files can be made in the folder: its nearest existing ancestor is a folder that can be written. */
const CREATABLE_SCRIPT = [
  'place="$0"',
  'while [ ! -e "$place" ] && [ "$place" != / ]; do place=$(dirname -- "$place"); done',
  '[ -d "$place" ] && [ -w "$place" ]',
].join('\n');

/** The kind of an entry, by its letter in a listing. */
function listedKindOf(letter: string): RootEntry['kind'] {
  if (letter === 'd') {
    return 'folder';
  }
  return letter === 'f' ? 'file' : 'other';
}

/** The bootstrap container `container`'s files, through `ports`' engine. */
export function bootstrapAuthoringFiles(
  ports: EngineStepPorts,
  container: string,
): AuthoringFiles {
  /** Runs `script` in the container's shell with `place` as `$0`; whether it exited 0. */
  async function succeeds(script: string, place: string): Promise<boolean> {
    return (
      await stepOf(ports, ['exec', container, '/bin/sh', '-c', script, place])
    ).succeeded;
  }

  /** Runs `script` with `place` as `$0`, and rejects with the engine's text when it fails. */
  async function required(script: string, place: string): Promise<string> {
    const result = await stepOf(ports, [
      'exec',
      container,
      '/bin/sh',
      '-c',
      script,
      place,
    ]);
    if (!result.succeeded) {
      throw new Error(result.detail);
    }
    return result.stdout;
  }

  return {
    kindOf: async (file): Promise<EntryKind> => {
      if (await succeeds('[ -d "$0" ]', file)) {
        return 'folder';
      }
      return (await succeeds('[ -e "$0" ]', file)) ? 'file' : 'missing';
    },
    exists: file => succeeds('[ -e "$0" ] || [ -L "$0" ]', file),
    list: async folder => {
      const listed = await stepOf(ports, [
        'exec',
        container,
        '/bin/sh',
        '-c',
        LIST_SCRIPT,
        folder,
      ]);
      if (!listed.succeeded) {
        return [];
      }
      return listed.stdout
        .split('\0')
        .filter(entry => entry !== '')
        .map(entry => ({
          name: entry.slice(2),
          kind: listedKindOf(entry.slice(0, 1)),
        }));
    },
    read: async file =>
      Buffer.from(await required('base64 "$0"', file), 'base64'),
    write: async (file, bytes) => {
      const outcome = await ports.engine.run(
        [
          'exec',
          '--interactive',
          container,
          '/bin/sh',
          '-c',
          'base64 -d > "$0"',
          file,
        ],
        {kind: 'text', text: Buffer.from(bytes).toString('base64')},
        ports.options,
      );
      if (outcome.kind === 'failed' || outcome.status !== 0) {
        throw new Error(`${file} could not be written in ${container}`);
      }
    },
    makeFolder: async folder => {
      await required('mkdir -p -- "$0"', folder);
    },
    removeFile: async file => {
      await required('rm -f -- "$0"', file);
    },
    removeFolder: async folder => {
      await required('rm -rf -- "$0"', folder);
    },
    creationProblem: async folder =>
      (await succeeds(CREATABLE_SCRIPT, folder))
        ? undefined
        : `${folder} can't be written in the clone's volume`,
  };
}
