import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  variable,
  connectedToContainer,
  reloadWindow,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {terminalText, typeInTerminal} from '../windows/renderer.ts';

/** The command that prints the three variables after `label`, so that a terminal restored by a reload shows no line of the last one. */
function probeCommand(label: string): string {
  return `printf '${label}:%s|%s|%s\\n' "$C45_PROFILE" "$C45_REMOTE" "$C45_BOTH"`;
}

/** The configuration file of `folder`. */
function configurationFile(folder: string): string {
  return path.join(folder, '.devcontainer', 'devcontainer.json');
}

/** Opens a terminal in window `name`, runs the probe command in it and gives the line it printed, or a timeout. */
async function printedLine(name: string, label: string): Promise<string> {
  await inWindow(name, 'workbench.action.terminal.new');
  await typeInTerminal(name, `${probeCommand(label)}\n`);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const line = (await terminalText(name))
      .split('\n')
      .map(each => each.trim())
      .find(each => each.startsWith(`${label}:`) && !each.includes('printf'));
    if (line !== undefined) {
      return line.slice(label.length + 1);
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the terminal of ${name}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

describe('Dev Containers: the remote environment (card containers-45)', function () {
  this.timeout(900_000);

  it('containers-45 (e1): a terminal gets the probe’s and remoteEnv’s variables, remoteEnv winning', async () => {
    const folder = devContainerFolder('c45-environment', {
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
      remoteEnv: {C45_REMOTE: 'remote', C45_BOTH: 'remote'},
    });
    try {
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN printf 'export C45_PROFILE=profile\\nexport C45_BOTH=profile\\n' >> /etc/profile\n`,
      );
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      deepStrictEqual(
        await printedLine(name, 'first'),
        'profile|remote|remote',
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('containers-45 (e2): editing userEnvProbe to none takes effect on reload, without a rebuild', async () => {
    const folder = devContainerFolder('c45-reload', {
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
      remoteEnv: {C45_REMOTE: 'remote', C45_BOTH: 'remote'},
    });
    try {
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN printf 'export C45_PROFILE=profile\\nexport C45_BOTH=profile\\n' >> /etc/profile\n`,
      );
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [before = ''] = await devContainersOf(folder);
      const configuration = JSON.parse(
        readFileSync(configurationFile(folder), 'utf8'),
      ) as Record<string, unknown>;
      writeFileSync(
        configurationFile(folder),
        JSON.stringify({...configuration, userEnvProbe: 'none'}),
      );
      await reloadWindow(name);
      await connectedToContainer(name);
      const [after = ''] = await devContainersOf(folder);
      deepStrictEqual(
        {
          sameContainer: after === before,
          line: await printedLine(name, 'second'),
        },
        {sameContainer: true, line: '|remote|remote'},
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
