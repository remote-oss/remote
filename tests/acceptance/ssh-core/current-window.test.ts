import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  connectedWithin,
  emptyWindows,
  hexOf,
  hostAnswer,
  hostPort,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  openWindow,
  recordLines,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  openWorkspaceWindow,
} from '../windows/folder-windows.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The command that reloads the window it runs in onto a picked host. */
const SWITCH = 'opensshremotes.openEmptyWindowInCurrentWindow';

/** The folder `name` of the launch's run, made. */
function folderOf(name: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** The failing new window's entries: the dialog, then the pick of actions, both dismissed. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** Runs the switch of local folder window `first`, answered by `answer`, and gives the empty window it comes back as. */
async function switched(
  first: string,
  answer: Parameters<typeof hostAnswer>[1],
): Promise<string> {
  appendScript([hostAnswer(first, answer)]);
  const next = await nextEmptyWindow(() => inWindow(first, SWITCH));
  await waitFor(
    `${next} to show its host`,
    async () => (await windowState(next)).remoteName === 'ssh-remote',
    120_000,
  );
  return next;
}

describe('Connect Current Window to Host', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2302 AC-4, AC-20 (pick): the command opens the host pick; dismissed: nothing opens and the window stays', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-pick'));
    const before = windowNames();
    appendScript([hostAnswer(first, 'dismiss')]);
    await inWindow(first, SWITCH);
    await waitFor(
      'the host pick',
      () => recordLines('hostPick', first).length > 0,
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pick = recordLines('hostPick', first)[0];
    deepStrictEqual(
      [
        pick?.question,
        pick?.items?.slice(-2),
        windowNames(),
        windowEvents(first).some(event => event.event === 'deactivated'),
      ],
      [
        'Select configured SSH host or enter user@host',
        ['$(plus) Add New SSH Host...', 'Configure SSH Hosts...'],
        before,
        false,
      ],
    );
  });

  it('F-2302 AC-5, AC-6 (switch): a host picked in a local window reloads it onto that host with no folder, and opens no new window', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-switch'));
    const next = await switched(first, {label: 'harness'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
        windowEvents(first).at(-1)?.event,
        emptyWindows(),
      ],
      ['ssh-remote+harness', [], 'deactivated', [next]],
    );
  });

  it('F-2302 AC-7: a typed user@host:port reloads the window onto the authority with that user and port', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-typed'));
    const port = hostPort();
    const next = await switched(first, {
      typed: `harness@127.0.0.1:${String(port)}`,
    });
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      `ssh-remote+${hexOf({hostName: '127.0.0.1', user: 'harness', port})}`,
    );
  });

  it('F-2302 AC-8: a folder window on one host picks another and reloads onto it with no folder', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-from');
    await connectedWithin('c41-from', 90_000);
    const next = await switched('c41-from', {label: 'noforward'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
      ],
      ['ssh-remote+noforward', []],
    );
  });

  it('F-2302 AC-17: a window on a host picks that host again and reloads empty on the same authority', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-again');
    await connectedWithin('c41-again', 90_000);
    const next = await switched('c41-again', {label: 'harness'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
        recordLines('notice', next),
      ],
      ['ssh-remote+harness', [], []],
    );
  });

  it('F-2302 AC-18: an empty local window picks a host and reloads onto it', async () => {
    await userSettings({...PLATFORMS});
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const next = await switched(empty, {label: 'harness'});
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      'ssh-remote+harness',
    );
  });

  it('F-2302 AC-21: the command given a host name argument reloads onto it with no pick', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-arg'));
    const next = await nextEmptyWindow(() =>
      inWindow(first, SWITCH, {host: 'harness'}),
    );
    await waitFor(
      `${next} to show its host`,
      async () => (await windowState(next)).remoteName === 'ssh-remote',
      120_000,
    );
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        recordLines('hostPick', first),
      ],
      ['ssh-remote+harness', []],
    );
  });

  it('F-2302 AC-19: a window whose connection failed and whose dialog was dismissed picks a host and reloads onto it', async () => {
    await userSettings({...PLATFORMS});
    appendScript(failureEntries('c41-refused'));
    await openWindow('refused', 'c41-refused');
    await waitFor(
      'the dismissed failure',
      () => recordLines('mitigationPick', 'c41-refused').length > 0,
      120_000,
    );
    const next = await switched('c41-refused', {label: 'harness'});
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      'ssh-remote+harness',
    );
  });

  it('F-2302 AC-27: the command given user@host:22 reloads onto an ssh-remote authority with no pick', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-port'));
    const next = nextEmptyName();
    appendScript(failureEntries(next));
    await nextEmptyWindow(() =>
      inWindow(first, SWITCH, {host: 'harness@127.0.0.1:22'}),
    );
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority?.startsWith('ssh-remote+'),
        recordLines('hostPick', first),
      ],
      [true, []],
    );
  });

  it('F-2302 AC-23: a typed unresolvable host fails in the reloaded window, whose More Actions pick opens', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-nohost'));
    const next = nextEmptyName();
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'More Actions...'},
        window: next,
      },
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window: next,
      },
    ]);
    await switched(first, {typed: 'nohost.invalid'});
    await waitFor(
      'the pick of actions',
      () => recordLines('mitigationPick', next).length > 0,
      120_000,
    );
    deepStrictEqual(
      [
        recordLines('failureDialog', next)[0]?.question.includes(
          'Could not resolve hostname',
        ),
        recordLines('mitigationPick', next)[0]?.question,
      ],
      [true, 'Pick an action to help resolve the problem.'],
    );
  });

  it('F-2302 AC-22: a refused password in the reloaded window ends in the failure dialog with the permission reason', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-wrong'));
    const next = nextEmptyName();
    appendScript([
      ...[1, 2, 3].map(() => ({
        surface: 'maskedInput' as const,
        match: 'Enter password',
        answer: {text: 'not-the-password'},
        window: next,
      })),
      ...failureEntries(next),
    ]);
    await switched(first, {label: 'password-retry'});
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', next).length > 0,
      120_000,
    );
    deepStrictEqual(
      recordLines('failureDialog', next)[0]?.question.includes(
        'Permission denied',
      ),
      true,
    );
  });

  it('F-2302 AC-10: a window that stays on the host stays connected when another window switches away', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-stay');
    await openWindow('harness', 'c41-leave');
    await connectedWithin('c41-stay', 90_000);
    await connectedWithin('c41-leave', 90_000);
    await switched('c41-leave', {label: 'noforward'});
    deepStrictEqual(
      [
        windowEvents('c41-stay').some(event => event.event === 'deactivated'),
        (await windowState('c41-stay')).remoteAuthority,
      ],
      [false, 'ssh-remote+harness'],
    );
  });

  it('F-2302 AC-31: a window on a multi-root workspace reloads onto the host with no folder and no workspace', async () => {
    await userSettings({...PLATFORMS});
    const file = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c41.code-workspace',
    );
    writeFileSync(
      file,
      JSON.stringify({
        folders: [
          {path: folderOf('c41-root-a')},
          {path: folderOf('c41-root-b')},
        ],
      }),
    );
    const first = await openWorkspaceWindow(file);
    const next = await switched(first, {label: 'harness'});
    const state = await windowState(next);
    deepStrictEqual([state.folders, state.workspaceFile], [[], null]);
  });

  it('F-2302 AC-28: Add New SSH Host then Connect opens a new window on the added host and the first keeps its folder', async () => {
    await userSettings({...PLATFORMS});
    const config = variable('HARNESS_SSH_CONFIG');
    const original = readFileSync(config, 'utf8');
    try {
      const first = await openFolderWindow(folderOf('c41-add'));
      const next = nextEmptyName();
      appendScript([
        hostAnswer(first, {label: '$(plus) Add New SSH Host...'}),
        {
          surface: 'textInput',
          match: 'Enter SSH Connection Command',
          answer: {text: 'cw-added'},
          window: first,
        },
        {
          surface: 'filePick',
          match: 'SSH configuration file',
          answer: {label: config},
          window: first,
        },
        {
          surface: 'notice',
          match: 'Host added',
          answer: {button: 'Connect'},
          window: first,
        },
        ...failureEntries(next),
      ]);
      await nextEmptyWindow(() => inWindow(first, SWITCH));
      deepStrictEqual(
        [
          (await windowState(next)).remoteAuthority,
          windowEvents(first).some(event => event.event === 'deactivated'),
        ],
        ['ssh-remote+cw-added', false],
      );
    } finally {
      writeFileSync(config, original);
    }
  });

  it('F-2302 AC-29: Configure SSH Hosts opens the picked file in the same window, which keeps its folder', async () => {
    await userSettings({...PLATFORMS});
    const config = variable('HARNESS_SSH_CONFIG');
    const first = await openFolderWindow(folderOf('c41-configure'));
    appendScript([
      hostAnswer(first, {label: 'Configure SSH Hosts...'}),
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: config},
        window: first,
      },
    ]);
    await inWindow(first, SWITCH);
    await waitFor(
      'the file in the editor',
      async () =>
        (await windowState(first)).activeTab?.uri.endsWith('ssh_config') ===
        true,
      30_000,
    );
    deepStrictEqual(
      [
        (await windowState(first)).folders.length,
        windowEvents(first).some(event => event.event === 'deactivated'),
      ],
      [1, false],
    );
  });
});
