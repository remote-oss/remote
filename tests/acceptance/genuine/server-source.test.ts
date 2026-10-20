import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  onHost,
  onHostAs,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogDetailLines,
  dialogKindOf,
  dialogOf,
  notifications,
  pressEscape,
  quickPickOf,
  settingsEditorOf,
  statusItem,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  DISPLAY_NAME,
  downloadLogsText,
  freshHost,
  homeNames,
  logMarks,
  noServerSourceText,
  requestsSince,
  TEMPLATE_SETTING,
  tlsNamesSince,
} from './genuine.ts';

/** The server template the run's download host answers: its own base, and the product's placeholders as they are. */
function hostTemplate(): string {
  return (
    `${variable('HARNESS_DOWNLOADS_HTTP')}/ok/` + '${os}-${arch}/${commit}'
  );
}

/** The buttons of a dialog as core's custom dialog draws them on Linux: in the reverse of the order of its items, core's own Cancel being the last item. */
function drawn(items: readonly string[]): string[] {
  return [...items].reverse();
}

/** The dialog of a message with no detail: core draws the message in the detail element and leaves the message element empty. */
function plainDialog(text: string, items: readonly string[]) {
  return {message: '', details: text, buttons: drawn(items)};
}

/** The licence modal's message, and its detail with the display name and the terms' address (§5a). */
const LICENCE_MESSAGE = "Accept the server's licence terms?";

function licenceDetail(termsUrl: string): string {
  return `The server ${DISPLAY_NAME} installs or starts on this host is distributed under licence terms of its own, which ${DISPLAY_NAME} does not accept for you. Read them at ${termsUrl} before you continue. "Accept and Continue" accepts them for this profile; the choice is remembered for this profile.`;
}

describe('where the server comes from, in genuine VS Code (card tooling-51, F-3902)', function () {
  this.timeout(600_000);
  let counter = 0;
  const opened: string[] = [];
  let savedSettings: string | undefined;

  /** The name of the next window: a folder of the harness user's home. */
  function nextName(): string {
    counter += 1;
    return `genuine-${String(counter)}`;
  }

  async function open(name: string): Promise<void> {
    await openWindow('harness', name);
    opened.push(name);
  }

  before(() => {
    savedSettings = readUserSettings();
  });

  after(() => {
    console.log(downloadLogsText());
  });

  beforeEach(async () => {
    await userSettings({
      [TEMPLATE_SETTING]: undefined,
      'remote.SSH.localServerDownload': 'off',
    });
    await freshHost();
  });

  afterEach(async () => {
    for (const name of opened.splice(0)) {
      await closeWindow(name).catch(() => undefined);
    }
    restoreUserSettings(savedSettings);
  });

  /** Waits for a dialog and reads what the rows of the no-source case compare. */
  async function noSourceShown(name: string) {
    const dialog = await waitForDialog(name, 120_000);
    return {dialog, kind: await dialogKindOf(name)};
  }

  /** What shows in window `name` once the dialogs are answered and the connect's progress toast has gone: the dialog, the toasts and the remote indicator. */
  async function leftOpen(name: string) {
    await waitFor(
      `the toasts of window ${name} to clear`,
      async () => (await notifications(name)).length === 0,
      15_000,
    );
    return {
      dialog: await dialogOf(name),
      toasts: await notifications(name),
      indicator: (await statusItem(name, 'status.host')).text,
    };
  }

  it('F-3902 AC-8, AC-25 (genuine-no-source): with the setting unset the client names its application name, makes no request and writes nothing on the host', async () => {
    const homeBefore = await homeNames();
    const marks = logMarks();
    const name = nextName();
    await open(name);
    const shown = await noSourceShown(name);
    const homeAfter = await homeNames();
    deepStrictEqual(
      {
        shown,
        namesTheEditor: [
          shown.dialog.details.includes('VSCodium'),
          shown.dialog.details.includes(editorProduct().nameLong),
        ],
        requests: requestsSince(marks.requests),
        handshakes: tlsNamesSince(marks.handshakes),
        home: homeAfter.filter(entry => !entry.startsWith('genuine-')),
        serverFolder: homeAfter.includes('.vscode-server'),
      },
      {
        shown: {
          dialog: plainDialog(
            noServerSourceText(editorProduct().applicationName),
            ['Open Setting', 'Cancel'],
          ),
          kind: 'error',
        },
        namesTheEditor: [false, false],
        requests: [],
        handshakes: [],
        home: homeBefore.filter(entry => !entry.startsWith('genuine-')),
        serverFolder: false,
      },
    );
    await answerDialog(name, 'Cancel');
  });

  it('F-3902 AC-9 (genuine-open-setting): Open Setting opens the Settings editor on the user tab, searching for the setting, and nothing else shows', async () => {
    const name = nextName();
    await open(name);
    await waitForDialog(name, 120_000);
    await answerDialog(name, 'Open Setting');
    await waitFor(
      `the Settings editor of window ${name}`,
      async () => (await settingsEditorOf(name)) !== undefined,
      30_000,
    );
    const left = await leftOpen(name);
    deepStrictEqual(
      {
        settings: await settingsEditorOf(name),
        dialog: left.dialog,
        toasts: left.toasts,
        disconnected: left.indicator.includes('Disconnected from SSH'),
      },
      {
        settings: {target: 'User', search: TEMPLATE_SETTING},
        dialog: undefined,
        toasts: [],
        disconnected: true,
      },
    );
  });

  it('F-3902 AC-9 (genuine-cancel): Cancel closes the dialog, opens no Settings editor and shows nothing else', async () => {
    const name = nextName();
    await open(name);
    await waitForDialog(name, 120_000);
    await answerDialog(name, 'Cancel');
    await waitFor(
      `the dialog of window ${name} to close`,
      async () => (await dialogOf(name)) === undefined,
      10_000,
    );
    const left = await leftOpen(name);
    deepStrictEqual(
      {
        settings: await settingsEditorOf(name),
        dialog: left.dialog,
        toasts: left.toasts,
        disconnected: left.indicator.includes('Disconnected from SSH'),
      },
      {settings: undefined, dialog: undefined, toasts: [], disconnected: true},
    );
  });

  it('F-3902 AC-17 (genuine-workspace-only): a value in the workspace settings alone is no source: the no-source dialog shows, with no request and no licence modal', async () => {
    const settingsFile = '/home/harness/genuine-ws/.vscode/settings.json';
    await onHost(
      'sh',
      '-c',
      `mkdir -p /home/harness/genuine-ws/.vscode && printf %s "$0" > ${settingsFile}`,
      JSON.stringify({[TEMPLATE_SETTING]: hostTemplate()}),
    );
    const marks = logMarks();
    await open('genuine-ws');
    const shown = await noSourceShown('genuine-ws');
    deepStrictEqual(
      {shown, requests: requestsSince(marks.requests)},
      {
        shown: {
          dialog: plainDialog(
            noServerSourceText(editorProduct().applicationName),
            ['Open Setting', 'Cancel'],
          ),
          kind: 'error',
        },
        requests: [],
      },
    );
    await answerDialog('genuine-ws', 'Cancel');
  });

  it('F-3902 AC-12, AC-24 (genuine-licence-cancel): a source under licence terms asks first, as an information modal with one item of ours, before any request; Cancel stops the connect, and a reload asks again', async () => {
    await userSettings({[TEMPLATE_SETTING]: hostTemplate()});
    const homeBefore = await homeNames();
    const marks = logMarks();
    const name = nextName();
    await open(name);
    const modal = await waitForDialog(name, 120_000);
    const asked = {
      modal,
      kind: await dialogKindOf(name),
      detail: (await dialogDetailLines(name)).join(' '),
      requests: requestsSince(marks.requests),
    };
    await answerDialog(name, 'Cancel');
    const failure = await waitForDialog(name, 60_000);
    await pressEscape(name);
    await waitForQuickPick(name, 30_000);
    await pressEscape(name);
    await waitFor(
      `the pick of window ${name} to close`,
      async () => (await quickPickOf(name)) === undefined,
      10_000,
    );
    const afterCancel = {
      failure: failure.details,
      requests: requestsSince(marks.requests),
      home: (await homeNames()).filter(entry => !entry.startsWith('genuine-')),
    };
    await reloadWindow(name);
    const again = await waitForDialog(name, 120_000);
    await answerDialog(name, 'Cancel');
    deepStrictEqual(
      {asked, afterCancel, again: again.message},
      {
        asked: {
          modal: {
            message: LICENCE_MESSAGE,
            details: asked.modal.details,
            buttons: drawn(['Accept and Continue', 'Cancel']),
          },
          kind: 'info',
          detail: licenceDetail(editorProduct().serverLicenseUrl),
          requests: [],
        },
        afterCancel: {
          failure:
            'Could not establish connection to "harness": Connecting was canceled.',
          requests: [],
          home: homeBefore.filter(entry => !entry.startsWith('genuine-')),
        },
        again: LICENCE_MESSAGE,
      },
    );
  });

  it('F-3902 AC-15 (genuine-mit-release): a release address of the MIT build is no licensed source: the connect fails on the download, the stand-in sees a TLS attempt for github.com, and nothing reaches update.code.visualstudio.com', async () => {
    const gateway = (
      await onHostAs(
        'root',
        'sh',
        '-c',
        "getent hosts update.code.visualstudio.com | cut -d' ' -f1",
      )
    ).trim();
    const port = new URL(variable('HARNESS_DOWNLOADS_HTTPS')).port;
    const rule = `-t nat OUTPUT -p tcp -d ${gateway} --dport 443 -j DNAT --to-destination ${gateway}:${port}`;
    await onHostAs(
      'root',
      'sh',
      '-c',
      `echo '${gateway} github.com' >> /etc/hosts && iptables -t nat -A ${rule.replace('-t nat ', '')}`,
    );
    await userSettings({
      [TEMPLATE_SETTING]:
        'https://github.com/VSCodium/vscodium/releases/download/' +
        '${version}/vscodium-reh-${os}-${arch}-${version}.tar.gz',
    });
    try {
      const marks = logMarks();
      const name = nextName();
      await open(name);
      const dialog = await waitForDialog(name, 180_000);
      const handshakes = tlsNamesSince(marks.handshakes);
      deepStrictEqual(
        {
          message: dialog.details,
          licenceModal: dialog.message === LICENCE_MESSAGE,
          githubAttempted: handshakes.some(line =>
            line.endsWith(' github.com'),
          ),
          microsoft: requestsSince(marks.requests).filter(line =>
            line.includes('update.code.visualstudio.com'),
          ),
        },
        {
          message:
            'Could not establish connection to "harness": Downloading VS Code Server failed. Please try again later.',
          licenceModal: false,
          githubAttempted: true,
          microsoft: [],
        },
      );
      await pressEscape(name);
    } finally {
      await onHostAs(
        'root',
        'sh',
        '-c',
        `grep -v ' github.com$' /etc/hosts > /tmp/hosts && cat /tmp/hosts > /etc/hosts; iptables -t nat -D ${rule.replace('-t nat ', '')}`,
      );
    }
  });
});
