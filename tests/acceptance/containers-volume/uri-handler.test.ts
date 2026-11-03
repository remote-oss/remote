/**
 * @fileoverview The "Open in Dev Containers" link (card containers-154): what the extension does with a link on the
 * editor's own scheme, from the editor's confirmation to the clone's own checks.
 */

import {deepStrictEqual} from 'node:assert';
import {
  containersLog,
  containersLogSince,
  openLink,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
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

/** The dialog the local window shows once the editor's question is answered, or undefined after the quiet time. */
async function dialogAfterQuiet(): Promise<
  Awaited<ReturnType<typeof dialogOf>>
> {
  await new Promise(resolve => setTimeout(resolve, QUIET_MILLISECONDS));
  return dialogOf('local');
}

describe('the "Open in Dev Containers" link (card containers-154)', function () {
  this.timeout(600_000);

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

  it('F-0706 AC-10, AC-17 (c154-unreachable-part): an unreachable repository is checked before the warning, and shows F-0701’s S052 with OK only', async () => {
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
});
