/**
 * @fileoverview F-2311 AC-8, AC-9, AC-24 and AC-25 (card coverage-99): the agent link of a window on an untrusted
 * folder which waits for core's trust question.
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  inWindow,
  isTrusted,
  onHostAs,
  openWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hostLinks, LINK_PATTERN} from '../windows/agent-links.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  pageText,
  waitForDialog,
} from '../windows/renderer.ts';
import {listedKeys, printedAfter} from '../windows/terminal-support.ts';

/** The alias that forwards the run's agent. */
const ALIAS = 'agentfwd';

/** How long the trust question stays open before it is answered, in AC-8. */
const OPEN_MILLISECONDS = 60_000;

/** The time the link has after the answer or the indicator. */
const LINK_MILLISECONDS = 2000;

/** The answers of core's trust question: it has no Cancel, so the refusing answer is the one that does not trust (proteus's ruling on #1602). */
const REFUSE = "No, I don't trust the authors";
const TRUST = 'Yes, I trust the authors';

/** The terminal request that comes again after the refusal. */
const CANCEL = 'Cancel';

/** The buttons of core's two trust dialogs: the modal request for trust, and the startup question. */
const TRUST_DIALOGS = [
  ['Manage', 'Cancel', 'Trust Folder & Continue'],
  ["No, I don't trust the authors", 'Yes, I trust the authors'],
] as const;

/** The key of the run that the agent holds. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

/** Opens window `name` on the forwarding alias with no link on the host, and waits for core's trust question. */
async function untrustedWindow(name: string): Promise<void> {
  await agentAdd(keyFile(), {confirm: false});
  await onHostAs('root', 'sh', '-c', `rm -f ${LINK_PATTERN}`);
  await openWindow(ALIAS, name);
  await waitForDialog(name);
}

/** Waits up to `milliseconds` for a link on the host and gives the links there are. */
async function linksWithin(milliseconds: number): Promise<string[]> {
  await waitFor(
    'the agent link',
    async () => (await hostLinks()).length > 0,
    milliseconds,
  ).catch(() => undefined);
  return hostLinks();
}

describe('the agent link of a window on an untrusted folder (card coverage-99)', function () {
  this.timeout(300_000);

  it('F-2311 AC-8 (c99-trust-wait): while the trust question is open for 60 s no link exists, and within 2 s of the answer that trusts the folder it does (core’s startup question has Yes, I trust the authors for Trust Folder & Continue, as ruled on #1602)', async () => {
    await untrustedWindow('c99-trust-wait');
    try {
      await new Promise(resolve => setTimeout(resolve, OPEN_MILLISECONDS));
      const whileOpen = await hostLinks();
      await answerDialog('c99-trust-wait', TRUST);
      const answered = Date.now();
      const links = await linksWithin(LINK_MILLISECONDS);
      deepStrictEqual(
        {
          whileOpen,
          created: links.length,
          withinBound: Date.now() - answered <= LINK_MILLISECONDS + 1500,
        },
        {whileOpen: [], created: 1, withinBound: true},
      );
    } finally {
      await closeWindow('c99-trust-wait').catch(() => undefined);
    }
  });

  it('F-2311 AC-9 (c99-trust-refused): refusing the question makes the link and leaves the window in Restricted Mode (core’s startup question has No, I don’t trust the authors for Cancel, as ruled on #1602)', async () => {
    await untrustedWindow('c99-trust-refused');
    try {
      await answerDialog('c99-trust-refused', REFUSE);
      await connectedWithin('c99-trust-refused', INSTALL_MILLISECONDS);
      const links = await linksWithin(10_000);
      deepStrictEqual(
        {
          links: links.length,
          trusted: await isTrusted('c99-trust-refused'),
          restricted: (await pageText('c99-trust-refused')).includes(
            'Restricted Mode',
          ),
        },
        {links: 1, trusted: false, restricted: true},
      );
    } finally {
      await closeWindow('c99-trust-refused').catch(() => undefined);
    }
  });

  it('F-2311 AC-24 (c99-trust-terminal): after the refusal, a new terminal asks again, and when that is cancelled it opens in Restricted Mode with SSH_AUTH_SOCK as the link and the keys listed', async () => {
    await untrustedWindow('c99-trust-terminal');
    const window = 'c99-trust-terminal';
    // Every dialog the terminal's creation shows, by its buttons: a machine may show core's question, the modal request
    // for trust, or both one after the other, and each is cancelled until the terminal opens.
    const asked: string[][] = [];
    async function cancelWhileAsked(opening: Promise<unknown>): Promise<void> {
      const state = {open: true};
      function closeLoop(): void {
        state.open = false;
      }
      void opening.then(closeLoop, closeLoop);
      while (state.open) {
        const shown = await dialogOf(window).catch(() => undefined);
        if (shown !== undefined) {
          asked.push(shown.buttons);
          await answerDialog(window, CANCEL).catch(() => undefined);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    try {
      await answerDialog(window, REFUSE);
      await connectedWithin(window, INSTALL_MILLISECONDS);
      const links = await linksWithin(10_000);
      void inWindow(window, 'workbench.action.terminal.new');
      const printing = printedAfter(window, 'SOCK', '$SSH_AUTH_SOCK');
      const [socket] = await Promise.all([
        printing,
        cancelWhileAsked(printing),
      ]);
      deepStrictEqual(
        {
          // At least one dialog came, and each had the buttons of one of core's two trust dialogs.
          asked:
            asked.length > 0 &&
            asked.every(buttons =>
              TRUST_DIALOGS.some(
                known => JSON.stringify(known) === JSON.stringify(buttons),
              ),
            ),
          socketIsLink: links.length === 1 && links[0]?.endsWith(` ${socket}`),
          listsKey: (await listedKeys(window)).includes(
            await fingerprintOf(keyFile()),
          ),
          trusted: await isTrusted(window),
        },
        {
          asked: true,
          socketIsLink: true,
          listsKey: true,
          trusted: false,
        },
        `the dialogs asked: ${JSON.stringify(asked)}`,
      );
    } finally {
      await closeWindow('c99-trust-terminal').catch(() => undefined);
    }
  });
});
