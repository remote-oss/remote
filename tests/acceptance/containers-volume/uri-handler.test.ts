/**
 * @fileoverview The "Open in Dev Containers" link (card containers-154): what the extension does with a link on the
 * editor's own scheme, from the editor's confirmation to the clone's own checks.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  containersLogSince,
  inWindow,
  nextEmptyWindow,
  openEmptyWindows,
  openLink,
  windowState,
} from '../windows/harness.ts';
import {
  clonedVolumes,
  containersWith,
  dockerLines,
  removeClone,
} from '../windows/volume-clones.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  quickPickOf,
  waitForDialog,
} from '../windows/renderer.ts';

/** The extension's part of a link: its id as the link's authority. */
const AUTHORITY = 'remote-oss.remote-containers';

/** A public repository the rows check but never clone. */
const REPOSITORY = 'https://github.com/microsoft/vscode-remote-try-node';

/** A repository on a host name that never resolves, whose check fails without asking anything. */
const UNREACHABLE = 'https://no-such-host-c154.invalid/r';

/** The editor's own question before an extension handles a link. */
const EDITOR_QUESTION = "Allow 'Dev Containers' extension to open this URI?";

/** The repository's own name: the folder under `/workspaces`, and the window's. */
const FOLDER = 'vscode-remote-try-node';

/** The text of the clone warning, which shows once in the profile. */
const CLONE_WARNING =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** How long a row waits to see that nothing appears. */
const QUIET_MILLISECONDS = 5_000;

/** Opens `<scheme>://<extension><rest>` from the local window and accepts the editor's question; gives the link's text. */
async function openAccepted(rest: string): Promise<string> {
  const text = await openLink('local', `{scheme}://${AUTHORITY}${rest}`);
  const asked = await waitForDialog('local');
  if (asked.message !== EDITOR_QUESTION) {
    throw new Error(`expected the editor's question, saw ${asked.message}`);
  }
  await answerDialog('local', 'Open');
  return text;
}

/** What a clone by link showed: a pick before the connect, and the empty windows left that weren't there before. */
interface LinkedClone {
  picked: boolean;
  emptyWindows: string[];
}

/**
 * Opens a clone link for `source` in a new empty window, accepts the editor's question and the clone warning if it
 * shows, and gives what showed until the window connected to the clone.
 */
async function cloneByLink(source: string): Promise<LinkedClone> {
  const known = openEmptyWindows();
  const window = await nextEmptyWindow(() =>
    inWindow('local', 'workbench.action.newWindow'),
  );
  await openLink(
    window,
    `{scheme}://${AUTHORITY}/cloneInVolume?url=${encodeURIComponent(source)}`,
  );
  await waitForDialog(window);
  await answerDialog(window, 'Open');
  await new Promise(resolve => setTimeout(resolve, QUIET_MILLISECONDS));
  // A window that the clone has already replaced has no page left, and shows no pick.
  const picked = await quickPickOf(window).then(
    shown => shown !== undefined,
    () => false,
  );
  for (const name of [window, FOLDER]) {
    const shown = await dialogOf(name).catch(() => undefined);
    if (shown?.message === CLONE_WARNING) {
      await answerDialog(name, 'Got It');
    }
  }
  await connectedToContainer(FOLDER, 900_000);
  return {
    picked,
    emptyWindows: openEmptyWindows().filter(each => !known.includes(each)),
  };
}

/** The id and start time of the clone's running dev container. */
async function runningClone(): Promise<string[]> {
  const [container] = await containersWith(
    `vsch.local.repository=${REPOSITORY}`,
  );
  return dockerLines(
    'inspect',
    '--format',
    '{{.Id}} {{.State.StartedAt}}',
    String(container),
  );
}

/** The dialog the local window shows once the editor's question is answered, or undefined after the quiet time. */
async function dialogAfterQuiet(): Promise<
  Awaited<ReturnType<typeof dialogOf>>
> {
  await new Promise(resolve => setTimeout(resolve, QUIET_MILLISECONDS));
  return dialogOf('local');
}

describe('the "Open in Dev Containers" link (card containers-154)', function () {
  this.timeout(2_400_000);

  it('F-0706 AC-1, AC-8 (c154-path): a path other than cloneInVolume, by one letter’s case too, shows nothing and logs nothing', async () => {
    // The first link wakes the extension, which logs its own start; the rows' marks come after it.
    await openAccepted(`/unknownAction?url=${encodeURIComponent(REPOSITORY)}`);
    await dialogAfterQuiet();
    const mark = containersLog().length;
    const seen = [];
    for (const rest of [
      `/unknownAction?url=${encodeURIComponent(REPOSITORY)}`,
      `/CloneInVolume?url=${encodeURIComponent(REPOSITORY)}`,
    ]) {
      await openAccepted(rest);
      seen.push(await dialogAfterQuiet());
    }
    deepStrictEqual(
      {dialogs: seen, logged: containersLogSince(mark)},
      {dialogs: [undefined, undefined], logged: []},
    );
  });

  it('F-0706 AC-2, AC-3 (c154-missing): no url, an empty one and a URL key all show S178 with the link’s scheme, authority, path and query, and OK only', async () => {
    const seen = [];
    for (const rest of [
      '/cloneInVolume',
      '/cloneInVolume?url=',
      `/cloneInVolume?URL=${encodeURIComponent(REPOSITORY)}`,
    ]) {
      const text = await openAccepted(rest);
      const shown = await waitForDialog('local');
      await answerDialog('local', 'OK');
      seen.push({
        shown,
        expected: `Failed to handle the URI '${text.replace(/=/g, '%3D')}' expected a 'url' query parameter.`,
      });
    }
    deepStrictEqual(
      seen.map(({shown, expected}) => [
        shown.message,
        shown.details === expected,
        shown.buttons,
      ]),
      Array(3).fill(['', true, ['OK']]),
    );
  });

  it('F-0706 AC-15 (c154-first-url): a duplicated url uses the first value, not the S178 failure: here a value the clone refuses, which shows F-0701’s S052 with it', async () => {
    const link = `/cloneInVolume?url=${encodeURIComponent('ftp://example.com/r')}&url=${encodeURIComponent(REPOSITORY)}`;
    await openAccepted(link);
    const shown = await waitForDialog('local', 60_000);
    await answerDialog('local', 'OK');
    deepStrictEqual(
      {details: shown.details, buttons: shown.buttons},
      {
        details: "Cannot access the repository 'ftp://example.com/r'.",
        buttons: ['OK'],
      },
    );
  });

  it('F-0706 AC-4 (c154-malformed): a value with no scheme, with spaces or with a percent sign that escapes nothing shows F-0701’s S052 with the value, never an error of ours', async () => {
    const values = [
      'no-scheme-c154/a/b',
      'https://no-such-host-c154.invalid/a b',
      'https://no-such-host-c154.invalid/%zz',
    ];
    const seen = [];
    for (const value of values) {
      await openAccepted(`/cloneInVolume?url=${encodeURIComponent(value)}`);
      const shown = await waitForDialog('local', 120_000);
      await answerDialog('local', 'OK');
      seen.push(shown.details);
    }
    deepStrictEqual(
      seen,
      values.map(value => `Cannot access the repository '${value}'.`),
    );
  });

  it('F-0706 AC-10 (c154-unreachable): an unreachable repository is checked before the warning, and shows F-0701’s S052 with OK only', async () => {
    await openAccepted(`/cloneInVolume?url=${encodeURIComponent(UNREACHABLE)}`);
    const shown = await waitForDialog('local', 120_000);
    await answerDialog('local', 'OK');
    deepStrictEqual(
      {details: shown.details, buttons: shown.buttons},
      {
        details: `Cannot access the repository '${UNREACHABLE}'.`,
        buttons: ['OK'],
      },
    );
  });

  it('F-0706 AC-9, AC-12 (c154-other-ids): a link to the reference’s id, or to an id no extension has, reaches no code of ours: core says the extension was not found', async () => {
    await openAccepted(`/unknownAction?url=${encodeURIComponent(REPOSITORY)}`);
    await dialogAfterQuiet();
    const mark = containersLog().length;
    const seen = [];
    for (const extensionId of [
      'ms-vscode-remote.remote-containers',
      'nobody.no-such-extension',
    ]) {
      await openLink(
        'local',
        `{scheme}://${extensionId}/cloneInVolume?url=${encodeURIComponent(REPOSITORY)}`,
      );
      await new Promise(resolve => setTimeout(resolve, QUIET_MILLISECONDS));
      seen.push({
        dialog: await dialogOf('local'),
        notice: (await notifications('local')).some(text =>
          text.includes(
            `'${extensionId}' cannot be installed because it was not found`,
          ),
        ),
      });
    }
    deepStrictEqual(
      {seen, logged: containersLogSince(mark)},
      {
        seen: [
          {dialog: undefined, notice: true},
          {dialog: undefined, notice: true},
        ],
        logged: [],
      },
    );
  });

  it('F-0706 AC-13 (c154-gallery): a link to a gallery extension that isn’t installed gets core’s install-and-open question first; Cancel leaves nothing of ours', async () => {
    const mark = containersLog().length;
    const text = await openLink(
      'local',
      `{scheme}://redhat.vscode-yaml/cloneInVolume?url=${encodeURIComponent(REPOSITORY)}`,
    );
    const asked = await waitForDialog('local', 60_000);
    await answerDialog('local', 'Cancel');
    deepStrictEqual(
      {
        message: asked.message,
        details: asked.details,
        buttons: asked.buttons,
        logged: containersLogSince(mark),
      },
      {
        message: "Would you like to install 'YAML' extension from 'Red Hat'?",
        details: `This extension wants to open a URI:${text.replace(/=/g, '%3D')}`,
        buttons: ['Cancel', 'Install Extension and Open URI'],
        logged: [],
      },
    );
  });

  it('F-0706 AC-11 (c154-other-scheme): a link on a scheme that isn’t the editor’s reaches no code of ours: no question, no dialog, nothing logged', async () => {
    const mark = containersLog().length;
    await openLink(
      'local',
      `not-the-editor-scheme://${AUTHORITY}/cloneInVolume?url=${encodeURIComponent(REPOSITORY)}`,
    );
    deepStrictEqual(
      {dialog: await dialogAfterQuiet(), logged: containersLogSince(mark)},
      {dialog: undefined, logged: []},
    );
  });

  it('F-0706 AC-5, AC-6, AC-7, AC-20, AC-21 (c154-clone): a link clones in its own window with no pick; the same link in the connected window does nothing; the owner/repo form of it reuses the same volume', async () => {
    await removeClone(REPOSITORY);
    try {
      const pickedFirst = await cloneByLink(REPOSITORY);
      const volumes = await clonedVolumes(REPOSITORY);
      const before = await runningClone();
      await openLink(
        FOLDER,
        `{scheme}://${AUTHORITY}/cloneInVolume?url=${encodeURIComponent(REPOSITORY)}`,
      );
      await waitForDialog(FOLDER);
      await answerDialog(FOLDER, 'Open');
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const again = {
        dialog: await dialogOf(FOLDER),
        remoteName: (await windowState(FOLDER)).remoteName,
        container: await runningClone(),
        volumes: await clonedVolumes(REPOSITORY),
      };
      await closeWindow(FOLDER);
      const pickedShorthand = await cloneByLink(
        'microsoft/vscode-remote-try-node',
      );
      const afterShorthand = await clonedVolumes(REPOSITORY);
      await closeWindow(FOLDER);
      deepStrictEqual(
        {
          pickedFirst,
          volumes: volumes.length,
          again,
          pickedShorthand,
          afterShorthand,
        },
        {
          pickedFirst: {picked: false, emptyWindows: []},
          volumes: 1,
          again: {
            dialog: undefined,
            remoteName: 'dev-container',
            container: before,
            volumes,
          },
          pickedShorthand: {picked: false, emptyWindows: []},
          afterShorthand: volumes,
        },
      );
    } finally {
      await closeWindow(FOLDER).catch(() => undefined);
      await removeClone(REPOSITORY);
    }
  });
});
