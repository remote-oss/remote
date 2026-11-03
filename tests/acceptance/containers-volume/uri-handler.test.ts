/**
 * @fileoverview The "Open in Dev Containers" link (card containers-154): what the extension does with a link on the
 * editor's own scheme, from the editor's confirmation to the clone's own checks.
 */

import {deepStrictEqual} from 'node:assert';
import {
  containersLog,
  containersLogSince,
  openOwnLink,
} from '../windows/harness.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';

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
  const text = await openOwnLink('local', `${AUTHORITY}${rest}`);
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
});
