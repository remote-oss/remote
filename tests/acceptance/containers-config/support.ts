import {waitFor} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';

/** How long a file written by a lifecycle command is waited for in the container, in milliseconds. */
const FILE_MILLISECONDS = 90_000;

/** The text of `file` in container `containerId`, once it exists. */
export async function textOfFile(
  containerId: string,
  file: string,
): Promise<string> {
  await waitFor(
    `${file} to exist in the container`,
    async () =>
      (await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `test -f ${file} && echo y`,
      ).catch(() => '')) === 'y',
    FILE_MILLISECONDS,
  );
  return docker('exec', containerId, 'cat', file);
}
