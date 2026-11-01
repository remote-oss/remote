import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadWindow,
  relaunch,
  reopenInContainer,
  terminalBuffer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  terminalText,
  typeInTerminal,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** Runs `docker` with `programArguments` and gives its trimmed standard output. */
async function docker(...programArguments: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', programArguments);
  return stdout.trim();
}

/** The one container of `folder`; it fails when the number is not one. */
async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${String(containers.length)}`,
    );
  }
  return containerId;
}

/** The value of `variableName` in a plain `docker exec` of container `containerId`, empty when it has none. */
function execEnvOf(containerId: string, variableName: string): Promise<string> {
  return docker('exec', containerId, 'printenv', variableName).catch(() => '');
}

/**
 * Writes the folder `<run>/<name>` whose Dockerfile adds `dockerfileLines` to the run's image, with `configuration`
 * over the defaults, and a task `probe` that prints `taskCommand`'s output after `task:` when one is given.
 */
function envFolder(
  name: string,
  dockerfileLines: string,
  configuration: Readonly<Record<string, unknown>> = {},
  taskCommand?: string,
): string {
  const folder = devContainerFolder(name, {
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
    ...configuration,
  });
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n${dockerfileLines}`,
  );
  if (taskCommand !== undefined) {
    mkdirSync(path.join(folder, '.vscode'), {recursive: true});
    writeFileSync(
      path.join(folder, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [{label: 'probe', type: 'shell', command: taskCommand}],
      }),
    );
  }
  return folder;
}

/** Appends to the image's `/etc/profile` and to the file an interactive `sh` reads (`ENV`). */
function profileLines(profile: string, interactive = ''): string {
  return (
    `ENV ENV=/etc/c42-interactive\n` +
    `RUN printf '${profile}' >> /etc/profile && printf '${interactive}' >> /etc/c42-interactive\n`
  );
}

/** Opens `folder` in a window, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/**
 * The text the active terminal of `name` printed after `label:` on a line of its own. The buffer is read whole, which
 * joins a value the terminal wrapped over several rows.
 */
async function resultAfter(name: string, label: string): Promise<string> {
  let found: string | undefined;
  await waitFor(
    `the line ${label}: in window ${name}`,
    async () => {
      found = (await terminalBuffer(name))
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith(`${label}:`) && !line.includes('printf'))
        ?.slice(label.length + 1);
      return found !== undefined;
    },
    90_000,
  ).catch(async (caught: unknown) => {
    throw new Error(
      `${String(caught)}; the terminal shows: ${JSON.stringify(await terminalBuffer(name))}`,
      {cause: caught},
    );
  });
  return found ?? '';
}

/** Removes the containers of `folder` and the images the CLI built for it (`vsc-<name>-…`). */
async function cleanUp(folder: string): Promise<void> {
  await removeContainers(folder);
  const prefix = `vsc-${path.basename(folder).toLowerCase()}-`;
  const made = (await docker('images', '--format', '{{.Repository}}'))
    .split('\n')
    .filter(each => each.startsWith(prefix));
  if (made.length > 0) {
    await docker('image', 'rm', '-f', ...made).catch(() => '');
  }
}

/** The ids of the engine's images, sorted: the order `docker images` lists them in changes with their use. */
async function imageIds(): Promise<string[]> {
  return (await docker('images', '--format', '{{.ID}}')).split('\n').sort();
}

/** Reloads window `name` and gives the milliseconds until it is connected to its container again. */
async function reconnectMilliseconds(name: string): Promise<number> {
  const started = Date.now();
  await reloadWindow(name);
  await connectedToContainer(name, 120_000);
  return Date.now() - started;
}

/** The command that prints each of `variables` on a line of its own, `<label><index>:<value>`. */
function printing(label: string, variables: readonly string[]): string {
  return variables
    .map((each, index) => `printf '${label}${String(index)}:%s\\n' "$${each}"`)
    .join('; ');
}

/** The command that prints, on a line of its own each, the value each of `variables` had when the terminal's shell started. */
function printingAtStart(label: string, variables: readonly string[]): string {
  return variables
    .map(
      (each, index) =>
        `printf '${label}${String(index)}:%s\\n' "$(tr '\\0' '\\n' < /proc/$$/environ | sed -n 's/^${each}=//p')"`,
    )
    .join('; ');
}

/** What `printing(label, variables)` printed in a terminal of `name`, one value per variable. */
async function printed(
  name: string,
  label: string,
  variables: readonly string[],
): Promise<string[]> {
  await inWindow(name, 'workbench.action.terminal.new');
  await typeInTerminal(name, `${printing(label, variables)}\n`);
  const values: string[] = [];
  for (const index of variables.keys()) {
    values.push(await resultAfter(name, `${label}${String(index)}`));
  }
  return values;
}

/** Runs the task `probe` of window `name` and gives the text it printed after `task:`. */
async function taskOutput(name: string): Promise<string> {
  void inWindow(name, 'workbench.action.tasks.runTask', 'probe').catch(
    () => undefined,
  );
  return resultAfter(name, 'task');
}

describe('F-0416 the remote environment (card containers-42, group B)', function () {
  this.timeout(900_000);

  it('F-0416 AC-14 (x14): a remoteEnv HOME that does not exist connects with no dialog and no notice, the terminal has it, and a plain docker exec does not', async () => {
    const folder = envFolder('c42-remote-home', '', {
      remoteEnv: {HOME: '/custom/home/dir'},
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const home = await printed(name, 'home', ['HOME']);
      const plain = await execEnvOf(containerId, 'HOME');
      deepStrictEqual(
        [home, plain, await dialogOf(name), await notifications(name)],
        [
          ['/custom/home/dir'],
          await execEnvOf(containerId, 'HOME'),
          undefined,
          [],
        ],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-15 (x15): the terminal has the containerEnv and the remoteEnv variables, resolved, and a plain docker exec has only the containerEnv ones', async () => {
    const folder = envFolder('c42-env-split', '', {
      containerEnv: {
        MY_CONTAINER_VAR: 'container-value',
        MY_CONTAINER_VAR2: '${localEnv:HARNESS_RUN_ID}',
      },
      remoteEnv: {
        MY_REMOTE_VAR: 'remote-value',
        MY_REMOTE_VAR2: '${containerEnv:MY_CONTAINER_VAR}',
        MY_REMOTE_VAR3: '${localEnv:HARNESS_RUN_ID}',
        MY_REMOTE_DEFAULT: '${containerEnv:UNSET_VAR:my-default}',
      },
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const names = [
        'MY_CONTAINER_VAR',
        'MY_CONTAINER_VAR2',
        'MY_REMOTE_VAR',
        'MY_REMOTE_VAR2',
        'MY_REMOTE_VAR3',
        'MY_REMOTE_DEFAULT',
      ];
      const terminal = [
        ...(await printed(name, 'first', names.slice(0, 3))),
        ...(await printed(name, 'second', names.slice(3))),
      ];
      const plain = await Promise.all(
        names.map(each => execEnvOf(containerId, each)),
      );
      const runId = variable('HARNESS_RUN_ID');
      deepStrictEqual(
        [terminal, plain],
        [
          [
            'container-value',
            runId,
            'remote-value',
            'container-value',
            runId,
            'my-default',
          ],
          ['container-value', runId, '', '', '', ''],
        ],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-16 (x16): with the editor’s variable unset, both resolve to empty strings in the terminal, with no error', async () => {
    const folder = envFolder('c42-env-unset', '', {
      containerEnv: {MY_CONTAINER_VAR2: '${localEnv:F0416_LOCAL_VAR}'},
      remoteEnv: {MY_REMOTE_VAR3: '${localEnv:F0416_LOCAL_VAR}'},
    });
    try {
      const name = await reopened(folder);
      const terminal = await printed(name, 'unset', [
        'MY_CONTAINER_VAR2',
        'MY_REMOTE_VAR3',
      ]);
      deepStrictEqual(
        [terminal, await dialogOf(name), await notifications(name)],
        [['', ''], undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-17 (x17): after VS Code restarts with another local variable, the same container reconnects without a rebuild: the remoteEnv entry takes the new value in the terminal, the containerEnv one keeps the old in the terminal and in a plain docker exec', async () => {
    const folder = envFolder('c42-env-restart', '', {
      containerEnv: {MY_CONTAINER_VAR2: '${localEnv:F0416_LOCAL_VAR}'},
      remoteEnv: {MY_REMOTE_VAR3: '${localEnv:F0416_LOCAL_VAR}'},
    });
    try {
      const name = await openFolderWindow(folder);
      await relaunch(name, {environment: {F0416_LOCAL_VAR: 'hello-local'}});
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const names = ['MY_CONTAINER_VAR2', 'MY_REMOTE_VAR3'];
      const before = await printed(name, 'before', names);
      await relaunch(name, {environment: {F0416_LOCAL_VAR: 'changed-local'}});
      await connectedToContainer(name);
      const after = await printed(name, 'after', names);
      const plain = await execEnvOf(containerId, 'MY_CONTAINER_VAR2');
      deepStrictEqual(
        [before, after, plain, await devContainersOf(folder)],
        [
          ['hello-local', 'hello-local'],
          ['hello-local', 'changed-local'],
          'hello-local',
          [containerId],
        ],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-18 (x18): containerEnv SHELL is the terminal’s $SHELL, and $HOME is unchanged', async () => {
    const folder = envFolder('c42-shell-env', '', {
      containerEnv: {SHELL: '/bin/sh'},
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const terminal = await printed(name, 'shell', ['SHELL', 'HOME']);
      deepStrictEqual(terminal, [
        '/bin/sh',
        await execEnvOf(containerId, 'HOME'),
      ]);
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-23 (x23): a variable the image sets and /etc/profile changes has the profile’s value in the terminal and the image’s in a plain docker exec', async () => {
    const folder = envFolder(
      'c42-profile-wins',
      `ENV C42_VALUE=from-image\n${profileLines('export C42_VALUE=from-profile\\n')}`,
      {userEnvProbe: 'loginShell'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const terminal = await printed(name, 'value', ['C42_VALUE']);
      deepStrictEqual(
        [terminal, await execEnvOf(containerId, 'C42_VALUE')],
        [['from-profile'], 'from-image'],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-28, AC-29 (x28): each userEnvProbe value hands the terminal’s shell what its probe exports (read from the shell’s own start-up environment), and the terminal shows its interactive file under every value', async () => {
    // [the mode, what the terminal shows, what the terminal's shell was handed when it started]
    const cases: Array<[string | undefined, string[], string[]]> = [
      ['none', ['', 'bashrc'], ['', '']],
      ['interactiveShell', ['', 'bashrc'], ['', 'bashrc']],
      ['loginShell', ['profile', 'bashrc'], ['profile', '']],
      [undefined, ['profile', 'bashrc'], ['profile', 'bashrc']],
    ];
    const seen: Array<[string, string[], string[]]> = [];
    for (const [mode] of cases) {
      const folder = envFolder(
        `c42-probe-${mode ?? 'default'}`,
        profileLines(
          'export PROBE_PROFILE=profile\\n',
          'export PROBE_BASHRC=bashrc\\n',
        ),
        mode === undefined ? {} : {userEnvProbe: mode},
      );
      try {
        const name = await reopened(folder);
        const names = ['PROBE_PROFILE', 'PROBE_BASHRC'];
        const visible = await printed(name, 'term', names);
        await inWindow(name, 'workbench.action.terminal.new');
        const atStart: string[] = [];
        for (const [index, each] of names.entries()) {
          await typeInTerminal(
            name,
            `${printingAtStart(`start${String(index)}`, [each])}\n`,
          );
          atStart.push(await resultAfter(name, `start${String(index)}0`));
        }
        seen.push([mode ?? 'default', visible, atStart]);
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(
      seen,
      cases.map(([mode, visible, atStart]) => [
        mode ?? 'default',
        visible,
        atStart,
      ]),
    );
  });

  it('F-0416 AC-32 (x32): a default in a containerEnv and a remoteEnv entry is the terminal’s value when the editor’s variable is unset', async () => {
    const folder = envFolder('c42-env-default', '', {
      containerEnv: {
        MY_CONTAINER_VAR2: '${localEnv:F0416_LOCAL_VAR:container-default}',
      },
      remoteEnv: {MY_REMOTE_VAR3: '${localEnv:F0416_LOCAL_VAR:remote-default}'},
    });
    try {
      const name = await reopened(folder);
      deepStrictEqual(
        await printed(name, 'default', ['MY_CONTAINER_VAR2', 'MY_REMOTE_VAR3']),
        ['container-default', 'remote-default'],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-43 (x43): remoteEnv with a containerEnv reference takes the image’s value, and a variable only the login file defines falls back to the reference’s default', async () => {
    const folder = envFolder(
      'c42-env-reference',
      `ENV IMG_VAR=image-value\n${profileLines('export IMG_VAR=login-value\\nexport LOGIN_ONLY=login\\n')}`,
      {
        remoteEnv: {
          FROM_IMAGE: '${containerEnv:IMG_VAR}',
          FROM_LOGIN: '${containerEnv:LOGIN_ONLY:fallback}',
        },
      },
    );
    try {
      const name = await reopened(folder);
      deepStrictEqual(
        await printed(name, 'reference', ['FROM_IMAGE', 'FROM_LOGIN']),
        ['image-value', 'fallback'],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-45 (x45): a /etc/profile that ends with exit 1 still connects, with no dialog and no notice, and its earlier export is not in the terminal', async () => {
    const folder = envFolder(
      'c42-profile-exits',
      profileLines('export EARLY=early\\nexit 1\\n'),
    );
    try {
      const name = await reopened(folder);
      deepStrictEqual(
        [
          await printed(name, 'early', ['EARLY']),
          await dialogOf(name),
          await notifications(name),
        ],
        [[''], undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-46 (x46): a /etc/profile that never ends delays a connect by the probe’s limit of about 10 s and no more, with no dialog and no notice, and its earlier export is not in the terminal', async () => {
    const folder = envFolder(
      'c42-profile-sleeps',
      profileLines('export EARLY=early\\n[ -e /tmp/c42-slow ] && sleep 120\\n'),
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const control = await reconnectMilliseconds(name);
      await docker('exec', containerId, 'touch', '/tmp/c42-slow');
      const slowed = await reconnectMilliseconds(name);
      const delay = slowed - control;
      deepStrictEqual(
        [
          delay >= 8000 && delay <= 14_000 ? true : delay,
          await printed(name, 'early', ['EARLY']),
          await dialogOf(name),
          await notifications(name),
        ],
        [true, [''], undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-22 (x22): an Alpine remoteUser account made with adduser -D (shell /bin/sh) gets a plain $ prompt in the terminal', async () => {
    const folder = envFolder('c42-alpine-user', 'RUN adduser -D tester\n', {
      remoteUser: 'tester',
    });
    try {
      const name = await reopened(folder);
      await inWindow(name, 'workbench.action.terminal.new');
      let prompt = '';
      await waitFor(
        'the terminal to show a prompt',
        async () => {
          prompt =
            (await terminalText(name))
              .split('\n')
              .map(line => line.trim())
              .findLast(line => line !== '') ?? '';
          return prompt.endsWith('$');
        },
        60_000,
      ).catch((caught: unknown) => {
        throw new Error(
          `${String(caught)}; the last line is ${JSON.stringify(prompt)}`,
          {cause: caught},
        );
      });
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-31 (x31): by ruling 15, editing only userEnvProbe to none and reloading takes the login file’s variable out of a new terminal, with no new container or image', async () => {
    const folder = envFolder(
      'c42-probe-edit',
      profileLines('export PROBE_PROFILE=profile\\n'),
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const imagesBefore = await imageIds();
      const before = await printed(name, 'before', ['PROBE_PROFILE']);
      const file = path.join(folder, '.devcontainer', 'devcontainer.json');
      const configuration = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(
        file,
        JSON.stringify({...configuration, userEnvProbe: 'none'}),
      );
      await reloadWindow(name);
      await connectedToContainer(name);
      deepStrictEqual(
        [
          before,
          await printed(name, 'after', ['PROBE_PROFILE']),
          await containerOf(folder),
          await imageIds(),
        ],
        [['profile'], [''], containerId, imagesBefore],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });
  it('F-0416 AC-27 (c74-task-probe): a shell task prints neither probe variable for none, only the interactive one for interactiveShell, only the login one for loginShell, and both by default', async () => {
    const cases: Array<[string | undefined, string]> = [
      ['none', '|'],
      ['interactiveShell', '|bashrc'],
      ['loginShell', 'profile|'],
      [undefined, 'profile|bashrc'],
    ];
    const seen: Array<[string, string]> = [];
    for (const [mode] of cases) {
      const folder = envFolder(
        `c74-task-${mode ?? 'default'}`,
        profileLines(
          'export PROBE_PROFILE=profile\\n',
          'export PROBE_BASHRC=bashrc\\n',
        ),
        mode === undefined ? {} : {userEnvProbe: mode},
        `printf 'task:%s|%s\\n' "$PROBE_PROFILE" "$PROBE_BASHRC"`,
      );
      try {
        const name = await reopened(folder);
        seen.push([mode ?? 'default', await taskOutput(name)]);
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(
      seen,
      cases.map(([mode, printedText]) => [mode ?? 'default', printedText]),
    );
  });

  it('F-0416 AC-42 (c74-task-remote-env): remoteEnv wins over the probe for a variable both set, and a PATH built from the container’s own has the container’s PATH and the extra folder but not the login file’s', async () => {
    const folder = envFolder(
      'c74-task-remote',
      profileLines(
        'export REMOTE_WINS=probe\\nexport PATH=/profile-bin:$PATH\\n',
      ),
      {
        remoteEnv: {
          REMOTE_WINS: 'remote',
          PATH: '${containerEnv:PATH}:/remote-extra',
        },
      },
      `printf 'task:%s|%s\\n' "$REMOTE_WINS" "$PATH"`,
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const containerPath = await execEnvOf(containerId, 'PATH');
      const [wins = '', taskPath = ''] = (await taskOutput(name)).split('|');
      await closeWindow(name);
      deepStrictEqual(
        [
          wins,
          taskPath.includes(containerPath),
          taskPath.endsWith(':/remote-extra'),
          taskPath.includes('/profile-bin'),
        ],
        ['remote', true, true, false],
      );
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-44 (c74-null-remote-env): a remoteEnv null unsets an image variable in a task and in the terminal, and a plain docker exec still has it', async () => {
    const folder = envFolder(
      'c74-null-env',
      'ENV NULL_VAR=x\n',
      {remoteEnv: {NULL_VAR: null}},
      `printf 'task:%s\\n' "\${NULL_VAR-unset}"`,
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const task = await taskOutput(name);
      await inWindow(name, 'workbench.action.terminal.new');
      await typeInTerminal(name, `printf 'term:%s\\n' "\${NULL_VAR-unset}"\n`);
      const terminal = await resultAfter(name, 'term');
      const plain = await execEnvOf(containerId, 'NULL_VAR');
      await closeWindow(name);
      deepStrictEqual([task, terminal, plain], ['unset', 'unset', 'x']);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0416 AC-47 (c74-missing-shell): a remoteUser whose passwd shell is not in the image connects with no dialog, and opening a terminal shows the editor’s message about the missing shell', async () => {
    const folder = envFolder(
      'c74-missing-shell',
      'RUN adduser -D -s /bin/zsh zshuser\n',
      {remoteUser: 'zshuser'},
    );
    const said =
      'The terminal process failed to launch: Path to shell executable "/bin/zsh" does not exist.';
    try {
      const name = await reopened(folder);
      const atConnect = {
        dialog: await dialogOf(name),
        notices: await notifications(name),
      };
      await inWindow(name, 'workbench.action.terminal.new');
      await waitFor(
        'the notice about the missing shell',
        async () => (await notifications(name)).includes(said),
        60_000,
      );
      const state = {
        atConnect,
        dialog: await dialogOf(name),
        notices: await notifications(name),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        atConnect: {dialog: undefined, notices: []},
        dialog: undefined,
        notices: [said],
      });
    } finally {
      await cleanUp(folder);
    }
  });
});
