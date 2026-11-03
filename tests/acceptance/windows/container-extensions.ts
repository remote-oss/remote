/**
 * @fileoverview What the rows that read a container's extensions share: the folders the server installed there.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {editorProduct} from './harness.ts';

const execFileAsync = promisify(execFile);

/** The folders of the extensions installed in container `containerId` for the remote user; none while there is no folder. */
export async function installedIn(containerId: string): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$(cd; pwd)/${editorProduct().serverDataFolderName}/extensions"`,
    ]);
    return stdout.split('\n').filter(entry => entry !== '');
  } catch {
    return [];
  }
}
