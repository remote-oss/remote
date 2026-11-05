/**
 * @fileoverview F-0205 and F-0106 with a Docker engine reached over SSH (card tooling-123): Attach to Running Container
 * and Reopen in Container through an `ssh://` context, and a dev container made there against the same folder made on
 * the local engine. The folder is in a place the SSH host's container shares at the same path, so its bind resolves on
 * the host's side.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {
  dockerWith,
  sshClientEnvironment,
  sshEngine,
  type SshEngine,
} from '../windows/engine-fixture.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  reopenInContainer,
  runLabelArguments,
  runScopedName,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  inputBoxOf,
  pressEscape,
  quickPickRows,
  rememberPage,
  toastDetails,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** What a dev container of a folder is, as F-0205 BR-9 compares it: its devcontainer labels, mounts, user and kind of name. */
interface ContainerFacts {
  /** Whether the engine named it itself (adjective_name), as for any container made with no name. */
  generatedName: boolean;
  labels: Record<string, string>;
  mounts: string[];
  user: string;
}

/** The facts of the dev container that the engine `client` reaches holds for `folder`. */
async function factsOf(
  client: Readonly<Record<string, string>>,
  folder: string,
): Promise<ContainerFacts> {
  const [found = ''] = (
    await dockerWith(
      client,
      'ps',
      '-aq',
      '--filter',
      `label=devcontainer.local_folder=${folder}`,
    )
  ).split('\n');
  const inspected = JSON.parse(
    await dockerWith(client, 'inspect', '--format', '{{json .}}', found),
  ) as {
    Name: string;
    Config: {Labels: Record<string, string>; User: string};
    Mounts: Array<{Destination: string}>;
  };
  return {
    generatedName: /^\/[a-z]+_[a-z]+$/u.test(inspected.Name),
    labels: Object.fromEntries(
      Object.entries(inspected.Config.Labels).filter(([key]) =>
        key.startsWith('devcontainer.'),
      ),
    ),
    mounts: inspected.Mounts.map(each => each.Destination).sort(),
    user: inspected.Config.User,
  };
}

/** What window `name` shows besides its editor: whether a dialog or an input box is open, and its toasts. */
async function shownBy(
  name: string,
): Promise<{dialog: boolean; inputBox: boolean; toasts: string[]}> {
  return {
    dialog: (await dialogOf(name)) !== undefined,
    inputBox: (await inputBoxOf(name)) !== undefined,
    toasts: (await toastDetails(name)).map(each => each.message),
  };
}

describe('F-0205, the commands on an engine reached over SSH (card tooling-123)', function () {
  this.timeout(1_200_000);
  const shared = path.join(
    homedir(),
    '.cache',
    'remote-oss-acceptance',
    runScopedName('c205'),
  );
  const context = runScopedName('c205-cmd');
  let engine: SshEngine;
  let remote: Record<string, string>;

  before(async () => {
    await rememberPage('local');
    mkdirSync(shared, {recursive: true});
    engine = await sshEngine({shared});
    remote = {...sshClientEnvironment(), DOCKER_HOST: engine.address('engine')};
    await dockerWith(
      sshClientEnvironment(),
      'context',
      'create',
      context,
      '--docker',
      `host=${engine.address('engine')}`,
    );
  });

  afterEach(async () => {
    await pressEscape('local').catch(() => undefined);
    await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
  });

  after(async () => {
    await dockerWith({}, 'context', 'rm', '--force', context).catch(
      () => undefined,
    );
    await engine.stop();
    rmSync(shared, {recursive: true, force: true});
  });

  it('F-0205 AC-2 (c205-attach-part): with the ssh:// context current, Attach to Running Container... shows F-0106’s confirmation and then a picker that lists the container only that engine holds, with no other dialog, notification or input box', async () => {
    await dockerWith({}, 'context', 'use', context);
    await startInWindow('local', 'remote-containers.attachToRunningContainer');
    const warning = [...(await waitForDialog('local', 60_000)).buttons].sort();
    await answerDialog('local', 'Got It');
    await waitForQuickPick('local', 120_000);
    const rows = (await quickPickRows('local')).map(each => each.label);
    const toasts = (await toastDetails('local')).map(each => each.message);
    deepStrictEqual(
      {warning, listed: rows.includes('/only'), toasts},
      {warning: ['Cancel', 'Got It', 'Learn More'], listed: true, toasts: []},
    );
  });

  it('F-0205 AC-2, AC-15a, F-0106 AC-16 (c205-same): Reopen in Container through the ssh:// context proceeds as on the local engine, and makes a container whose devcontainer labels, mounts, user and kind of name are the local one’s, with nothing more shown', async () => {
    const folder = path.join(shared, 'c205-same');
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'Same',
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
      }),
    );
    try {
      const localWindow = await openFolderWindow(folder);
      await reopenInContainer(localWindow);
      const localShown = await shownBy(localWindow);
      const localFacts = await factsOf({}, folder);
      await closeWindow(localWindow);
      await dockerWith({}, 'context', 'use', context);
      const remoteWindow = await openFolderWindow(folder);
      await reopenInContainer(remoteWindow);
      const remoteShown = await shownBy(remoteWindow);
      const remoteFacts = await factsOf(remote, folder);
      await closeWindow(remoteWindow);
      deepStrictEqual(
        {shown: remoteShown, facts: remoteFacts},
        {shown: localShown, facts: localFacts},
      );
    } finally {
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
