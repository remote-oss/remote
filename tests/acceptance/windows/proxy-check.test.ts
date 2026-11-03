import {deepStrictEqual} from 'node:assert';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectedWithin,
  isOpen,
  noHelperWithin,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
} from './harness.ts';
import {dismissals} from './maintenance.ts';

/** The windows the rows open. */
const WINDOWS = ['p1', 'p2'];

/** A value the editor's strict URI parser rejects for its leading space. */
const SPACED = ' http://127.0.0.1:1';

/** The start of the dialog's detail for a value with a leading space. */
const SPACED_DETAIL =
  'Could not establish connection to "harness": [UriError]: Scheme contains illegal characters.';

/** The time of the RFC 3339 form the sshd log's `--since` takes. */
function now(): string {
  return new Date().toISOString();
}

/** The failure dialogs `window` showed from `mark` (a time in milliseconds) on. */
function dialogsOf(window: string, mark: number) {
  return recordLines('failureDialog', window).filter(line => line.time >= mark);
}

/** Opens `window` on the alias with the dialog dismissed, and gives the first dialog and the pick behind it. */
async function failedOn(window: string) {
  const mark = Date.now();
  appendScript([...dismissals(window)]);
  await openWindow('harness', window);
  await waitFor(
    `the failure dialog of ${window}`,
    () => dialogsOf(window, mark).length > 0,
    120_000,
  );
  return {
    dialog: dialogsOf(window, mark)[0],
    pick: () =>
      recordLines('mitigationPick', window).find(line => line.time >= mark),
  };
}

/** Connects `window` with the settings as they are. */
async function connectedOn(window: string): Promise<void> {
  await openWindow('harness', window);
  await connectedWithin(window, 90_000);
}

/** Closes `window` and waits until no helper is left, so the next window starts its own connection. */
async function closedWithNoHelper(window: string): Promise<void> {
  await closeWindow(window);
  await noHelperWithin(60_000);
}

describe('the proxy settings checked as URIs (card connect-141)', function () {
  this.timeout(400_000);
  let saved: string | undefined;

  beforeEach(() => {
    saved = readUserSettings();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    for (const window of WINDOWS) {
      if (isOpen(window)) {
        await closeWindow(window);
      }
    }
    await noHelperWithin(60_000);
  });

  it('F-2404 AC-14 (c141-space): a leading space stops the connect before any login, with the parser message and the three buttons', async () => {
    await userSettings({'remote.SSH.httpProxy': SPACED});
    const since = now();
    const {dialog} = await failedOn('p1');
    deepStrictEqual(
      [
        dialog?.question.startsWith(SPACED_DETAIL),
        dialog?.buttons,
        await acceptedKeyLogins(since),
      ],
      [true, ['Close Remote', 'Retry', 'More Actions...'], 0],
    );
  });

  it('F-2404 AC-14 (c141-new-window): a new window on a host whose server runs still checks the value', async () => {
    await connectedOn('p1');
    await userSettings({'remote.SSH.httpsProxy': SPACED});
    await closedWithNoHelper('p1');
    const since = now();
    const {dialog} = await failedOn('p2');
    deepStrictEqual(
      [
        dialog?.question.startsWith(SPACED_DETAIL),
        await acceptedKeyLogins(since),
      ],
      [true, 0],
    );
  });

  it('F-2404 AC-32 (c141-bare): a value with no colon ends in the parser\'s "Scheme is missing", with no login', async () => {
    await userSettings({'remote.SSH.httpProxy': '127.0.0.1'});
    const since = now();
    const {dialog} = await failedOn('p1');
    deepStrictEqual(
      [
        dialog?.question.startsWith(
          'Could not establish connection to "harness": [UriError]: Scheme is missing',
        ),
        await acceptedKeyLogins(since),
      ],
      [true, 0],
    );
  });

  it('F-2404 AC-35 (c141-entries): a number entry and an object entry stop the connect as their text', async () => {
    await userSettings({'remote.SSH.httpProxy': {'*': 8890}});
    const number = (await failedOn('p1')).dialog?.question;
    await closedWithNoHelper('p1');
    await userSettings({'remote.SSH.httpProxy': {'*': {port: 1}}});
    const object = (await failedOn('p2')).dialog?.question;
    deepStrictEqual(
      [
        number?.includes('path: "8890"'),
        object?.includes('path: "[object Object]"'),
      ],
      [true, true],
    );
  });

  it('F-2404 AC-41 (c141-reload): a reload that keeps the running connection neither checks nor applies the value, and a new window does', async () => {
    await connectedOn('p1');
    await userSettings({'remote.SSH.httpProxy': SPACED});
    const mark = Date.now();
    await reloadWindow('p1');
    await connectedWithin('p1', 30_000);
    const afterReload = dialogsOf('p1', mark).length;
    await closedWithNoHelper('p1');
    const {dialog} = await failedOn('p2');
    deepStrictEqual(
      [afterReload, dialog?.question.startsWith(SPACED_DETAIL)],
      [0, true],
    );
  });

  it("reading-1939-joined-window (c141-joined): a second window that joins the first one's connection connects with no dialog", async () => {
    await connectedOn('p1');
    await userSettings({'remote.SSH.httpProxy': SPACED});
    const mark = Date.now();
    await connectedOn('p2');
    deepStrictEqual(dialogsOf('p2', mark).length, 0);
  });

  it('F-2404 AC-15 (c141-actions): More Actions... holds no proxy item, and the window shows no notice', async () => {
    await userSettings({'remote.SSH.httpProxy': SPACED});
    const mark = Date.now();
    const {pick} = await failedOn('p1');
    await waitFor('the action pick', () => pick() !== undefined, 30_000);
    deepStrictEqual(
      [
        (pick()?.items ?? []).filter(item => /proxy/i.test(item)),
        recordLines('notice', 'p1').filter(line => line.time >= mark),
      ],
      [[], []],
    );
  });
});
