/**
 * @fileoverview Configure Container Features in a window on an SSH host (card containers-150, part E): the command is
 * offered there and not in the remote indicator's menu, the file it edits is on the host, and "Add Files..." adds the
 * files on the host with no choice of where.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  onHost,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {
  allQuickPickRows,
  answerDialog,
  clickStatusItem,
  editorTabs,
  notificationCentre,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickFacts,
  toggleQuickPickRow,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const PLAIN = 'Lab Plain';

/** The placeholder of the step that picks the template of a configuration. */
const TEMPLATE_PLACEHOLDER =
  'Select a container configuration template or enter a custom template id';

/** Makes the folder `name` of the host's home with the configuration `text`, or none, and gives its path on the host. */
async function hostFolder(name: string, text?: string): Promise<string> {
  const folder = `/home/harness/${name}`;
  await onHost('rm', '-rf', folder);
  await onHost('mkdir', '-p', `${folder}/.devcontainer`);
  if (text !== undefined) {
    await onHost(
      'sh',
      '-c',
      `printf '%s' '${text}' > ${folder}/.devcontainer/devcontainer.json`,
    );
  }
  return folder;
}

describe('Configure Container Features in a window on an SSH host (card containers-150, part E)', function () {
  this.timeout(600_000);

  it('F-0807 AC-5 (c150-ssh-menu): the remote indicator’s menu of a window on an SSH host lists its own entries and does not list Configure Container Features', async () => {
    await hostFolder('c150-ssh-menu');
    await openWindow('harness', 'c150-ssh-menu');
    try {
      await clickStatusItem('c150-ssh-menu', 'status.host');
      await waitFor(
        'the remote indicator’s menu',
        async () => (await quickPickFacts('c150-ssh-menu')) !== undefined,
        30_000,
      );
      const menu = (await allQuickPickRows('c150-ssh-menu')).map(
        each => each.label,
      );
      await pressEscape('c150-ssh-menu');
      deepStrictEqual(
        [
          menu.includes('Close Remote Connection'),
          menu.some(label => label.includes('Configure Container Features')),
        ],
        [true, false],
      );
    } finally {
      await closeWindow('c150-ssh-menu').catch(() => undefined);
    }
  });

  it('F-0807 AC-23 (c150-ssh-pick): in a window on an SSH host the pick is the one of a local window, Finish adds the Feature to the file on the host and opens it as a preview, and no rebuild notification shows', async () => {
    const folder = await hostFolder('c150-ssh-pick', '{"image": "x"}');
    const file = `${folder}/.devcontainer/devcontainer.json`;
    await openWindow('harness', 'c150-ssh-pick');
    try {
      inWindow('c150-ssh-pick', COMMAND).catch(() => undefined);
      await screenWith('c150-ssh-pick', FEATURES_PLACEHOLDER);
      const facts = await quickPickFacts('c150-ssh-pick');
      await toggleQuickPickRow('c150-ssh-pick', PLAIN);
      await pressQuickPickTitleButton('c150-ssh-pick', 'Finish');
      await waitFor(
        'the Feature in the file on the host',
        async () => (await onHost('cat', file)).includes('lab-plain'),
        60_000,
      );
      await new Promise(resolve => setTimeout(resolve, 4000));
      const activeTab = (await editorTabs('c150-ssh-pick')).find(
        each => each.active,
      );
      deepStrictEqual(
        {
          facts,
          activeTab,
          notices: (await notificationCentre('c150-ssh-pick')).filter(text =>
            text.startsWith('Configuration file(s) changed'),
          ),
        },
        {
          facts: {
            title: 'Select Features',
            placeholder: FEATURES_PLACEHOLDER,
            titleButtons: ['Finish'],
            multiSelect: true,
          },
          activeTab: {
            label: 'devcontainer',
            active: true,
            preview: true,
            dirty: false,
          },
          notices: [],
        },
      );
    } finally {
      await closeWindow('c150-ssh-pick').catch(() => undefined);
    }
  });

  it('F-0807 AC-51 (c150-ssh-add): in a window on an SSH host with no configuration, Add Files... opens the wizard at its template step, with no choice of where first', async () => {
    await hostFolder('c150-ssh-add');
    await onHost('rm', '-rf', '/home/harness/c150-ssh-add/.devcontainer');
    await openWindow('harness', 'c150-ssh-add');
    try {
      inWindow('c150-ssh-add', COMMAND).catch(() => undefined);
      await waitForDialog('c150-ssh-add', 60_000);
      await answerDialog('c150-ssh-add', 'Add Files...');
      await waitFor(
        'the first step of the wizard',
        async () => (await quickPickFacts('c150-ssh-add')) !== undefined,
        60_000,
      );
      const facts = await quickPickFacts('c150-ssh-add');
      await pressEscape('c150-ssh-add');
      deepStrictEqual(facts?.placeholder, TEMPLATE_PLACEHOLDER);
    } finally {
      await closeWindow('c150-ssh-add').catch(() => undefined);
    }
  });
});
