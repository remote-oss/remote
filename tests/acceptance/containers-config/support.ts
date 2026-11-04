import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {runLabelArguments, variable, waitFor} from '../windows/harness.ts';
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

/** Builds an image from the run's with `entries` as its metadata label (a text as it is, else as JSON) and gives its tag. */
export async function imageWithLabel(
  label: string,
  entries: unknown,
): Promise<string> {
  const context = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(context, {recursive: true});
  writeFileSync(
    path.join(context, 'Dockerfile'),
    [
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
      `LABEL devcontainer.metadata='${typeof entries === 'string' ? entries : JSON.stringify(entries)}'`,
      '',
    ].join('\n'),
  );
  const imageTag = `${label}:${variable('HARNESS_RUN_ID')}`;
  await docker('build', '--tag', imageTag, ...runLabelArguments(), context);
  return imageTag;
}
