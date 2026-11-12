/**
 * @fileoverview Host and user name validation (card coverage-120, F-2205): what the connect pick, the configured
 * aliases, the links and the server-maintenance commands do with a name that ssh cannot take, and the dialog a
 * rejected name shows in the window.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  appendScript,
  closeWindow,
  connectionHelpers,
  connectionLog,
  connectedWithin,
  hostAliases,
  hostAnswer,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  openWindow,
  recordLines,
  variable,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {statusBarText, terminalTabsOf} from '../windows/renderer.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
  pickHost,
  runWith,
  typeHost,
} from '../windows/maintenance.ts';

/** The troubleshooting terminal's label, which a rejected attempt leaves. */
const TROUBLESHOOT = 'Remote - SSH: Session Troubleshooting';

/** The buttons a rejected name's dialog carries; the reference's "Diagnose with Copilot" is not ours (F-3907). */
const BUTTONS = ['Retry', 'More Actions...', 'Close Remote'];

/** The bytes of the run's ssh_config. */
function configFile(): string {
  return readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
}


/** The notices window `window` showed since record index `mark`, as their text and buttons. */
function noticesSince(mark: number, window: string): Array<[string, string[]]> {
  return recordLines(undefined, window)
    .slice(mark)
    .filter(line => line.surface === 'notice')
    .map(line => [line.question, line.buttons ?? []]);
}

/** Types `host` into the connect pick of a fresh window and waits until that window's failure dialog was shown. */
async function reject(host: string): Promise<string> {
  const name = nextEmptyName();
  appendScript([hostAnswer('local', {typed: host}), ...dismissals(name)]);
  await nextEmptyWindow(() =>
    inWindow('local', 'opensshremotes.openEmptyWindow'),
  );
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    300_000,
  );
  return name;
}

/** Opens window `name` on the link `authority` and waits until its failure dialog was shown. */
async function openTo(authority: string, name: string): Promise<void> {
  await openWindow(authority, name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    300_000,
  );
}

/** Picks the configured alias `label` into a fresh window and waits until its failure dialog was shown. */
async function rejectViaPick(label: string): Promise<string> {
  appendScript([pickHost(label)]);
  const name = await nextEmptyWindow(() =>
    inWindow('local', 'opensshremotes.openEmptyWindow'),
  );
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    300_000,
  );
  return name;
}

/** The failure dialog of window `name`, as its record line holds it: the question (the detail) and the buttons. */
function failureDialog(name: string): {
  detail: string | undefined;
  buttons: string[] | undefined;
} {
  const [line] = recordLines('failureDialog', name);
  return {detail: line?.question, buttons: line?.buttons};
}

describe('host and user name validation (card coverage-120)', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2205 AC-1, AC-2, AC-3 (c120-dash-host): typing -oProxyCommand=x into the connect pick accepts Enter, and the new window refuses it with the host-name dialog, no helper, disconnected', async () => {
    const before = (await connectionHelpers()).length;
    const name = await reject('-oProxyCommand=x');
    try {
      const dialog = failureDialog(name);
      deepStrictEqual(
        [
          dialog.detail,
          [...(dialog.buttons ?? [])].sort(),
          (await statusBarText(name, 'status.host')).includes(
            'Disconnected from SSH',
          ),
          (await connectionHelpers()).length - before,
        ],
        [
          'Could not establish connection to "-oProxyCommand=x": SSH host name cannot begin with -.',
          [...BUTTONS].sort(),
          true,
          0,
        ],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-4 (c120-pct-host): a host with one forbidden character is refused naming that character', async () => {
    const name = await reject('a%b');
    try {
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "a%b": SSH host name cannot include the character %.',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-5 (c120-chars-host): the host check names the character the criterion reports', async () => {
    const seen: string[] = [];
    for (const host of ["a%b'c", 'a!b`c', 'a`%b']) {
      const name = await reject(host);
      try {
        seen.push(failureDialog(name).detail ?? '');
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    }
    deepStrictEqual(seen, [
      'Could not establish connection to "a%b\'c": SSH host name cannot include the character \'.',
      'Could not establish connection to "a!b`c": SSH host name cannot include the character `.',
      'Could not establish connection to "a`%b": SSH host name cannot include the character `.',
    ]);
  });

  it('F-2205 AC-6 (c120-dash-user): a user name that begins with a dash is refused naming the host part', async () => {
    const name = await reject('-u@h.invalid');
    try {
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "h.invalid": SSH user name cannot begin with -.',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-7 (c120-chars-user): a user name with a forbidden character is refused naming that character', async () => {
    const seen: string[] = [];
    for (const user of ['u!x', "u'x", 'u"x', 'u`x', 'u%x', 'u\\x']) {
      const name = await reject(`${user}@h.invalid`);
      try {
        seen.push(failureDialog(name).detail ?? '');
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    }
    deepStrictEqual(
      seen,
      ['!', "'", '"', '`', '%', '\\'].map(
        character =>
          `Could not establish connection to "h.invalid": SSH user name cannot include the character ${character}.`,
      ),
    );
  });

  it('F-2205 AC-8 (c120-combined): a name with several faults reports the check that fires, per the criterion', async () => {
    const [first, second, third, fourth] = [
      await reject('-u@-h'),
      await reject('u%@a%b'),
      await reject('u%@-h'),
      await reject('-u@a b'),
    ];
    try {
      deepStrictEqual(
        [first, second, third, fourth].map(name => failureDialog(name).detail),
        [
          'Could not establish connection to "-h": SSH host name cannot begin with -.',
          'Could not establish connection to "a%b": SSH host name cannot include the character %.',
          'Could not establish connection to "-h": SSH host name cannot begin with -.',
          'Could not establish connection to "a b": SSH user name cannot begin with -.',
        ],
      );
    } finally {
      await Promise.all([first, second, third, fourth].map(closeWindow));
    }
  });

  it('F-2205 AC-9 (c120-port-user): a port and a user on the link are dropped from the name the dialog reports', async () => {
    const [first, second] = [await reject('-h:22'), await reject('u@a%b:2222')];
    try {
      deepStrictEqual(
        [first, second].map(name => failureDialog(name).detail),
        [
          'Could not establish connection to "-h": SSH host name cannot begin with -.',
          'Could not establish connection to "a%b": SSH host name cannot include the character %.',
        ],
      );
    } finally {
      await Promise.all([first, second].map(closeWindow));
    }
  });

  /** Saves the run's ssh_config, appends `extra`, runs `body`, and restores the config. */
  async function withConfig(
    extra: string,
    body: () => Promise<unknown>,
  ): Promise<unknown> {
    const saved = configFile();
    writeFileSync(variable('HARNESS_SSH_CONFIG'), saved + extra);
    try {
      return await body();
    } finally {
      writeFileSync(variable('HARNESS_SSH_CONFIG'), saved);
    }
  }

  it('F-2205 AC-10 (c120-semicolon): a semicolon passes our check, so ssh itself refuses it and the dialog carries its text', async () => {
    const name = await reject('a;b');
    try {
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "a;b": Hostname contains invalid characters.',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-11 (c120-allowed): a host whose characters the check allows reaches ssh, so no validation message appears', async () => {
    const hosts = [
      '.lead',
      '1lead',
      'trai-',
      'inn-er',
      'star*',
      'quest?',
      'hash#',
      'colon:',
      'accent\u00e9',
    ];
    for (const host of hosts) {
      const name = await reject(host);
      try {
        const detail = failureDialog(name).detail ?? '';
        deepStrictEqual(
          [
            detail.includes('SSH host name cannot'),
            detail.includes('SSH user name cannot'),
          ],
          [false, false],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    }
  });

  it('F-2205 AC-12 (c120-semicolon-user): a semicolon in the user passes our check, so the dialog is the reasonless one naming the host', async () => {
    const name = await reject('u;x@h.invalid');
    try {
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "h.invalid".',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it("F-2205 AC-31 (c120-user-allowed): a user whose characters the check allows gives no user-name message; the outcome is ssh's", async () => {
    const users = [
      'u*x',
      'u x',
      'u$x',
      'u-x',
      '.u',
      '1u',
      'u?x',
      'u#x',
      'u,x',
      'u[x',
      'u=x',
    ];
    for (const user of users) {
      const name = await reject(`${user}@h.invalid`);
      try {
        const detail = failureDialog(name).detail ?? '';
        deepStrictEqual(
          [
            detail.includes('SSH user name cannot'),
            detail.includes('SSH host name cannot'),
          ],
          [false, false],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    }
  });

  it('F-2205 AC-32 (c120-empty-user): a user on an empty host names the host check; an empty host names the link as-is', async () => {
    const [first, second] = [await reject('@-h'), await reject('u@')];
    try {
      deepStrictEqual(
        [first, second].map(name => failureDialog(name).detail),
        [
          'Could not establish connection to "-h": SSH host name cannot begin with -.',
          'Could not establish connection to "u@".',
        ],
      );
    } finally {
      await Promise.all([first, second].map(closeWindow));
    }
  });

  it('F-2205 AC-21 (c120-retry): Retry reloads the window and the same dialog returns', async () => {
    const name = nextEmptyName();
    appendScript([
      hostAnswer('local', {typed: '-oProxyCommand=x'}),
      {surface: 'failureDialog', match: 'Could not establish connection', answer: {button: 'Retry'}, window: name},
      {surface: 'failureDialog', match: 'Could not establish connection', answer: 'dismiss', window: name},
    ]);
    await nextEmptyWindow(() => inWindow('local', 'opensshremotes.openEmptyWindow'));
    await waitFor(
      `two failure dialogs of ${name}`,
      () => recordLines('failureDialog', name).length >= 2,
      300_000,
    );
    const details = recordLines('failureDialog', name).map(line => line.question);
    deepStrictEqual([details[0], details[1] === details[0]], [
      'Could not establish connection to "-oProxyCommand=x": SSH host name cannot begin with -.',
      true,
    ]);
    await closeWindow(name).catch(() => undefined);
  });

  it('F-2205 AC-22 (c120-close): Close Remote leaves the window an empty local window', async () => {
    const name = nextEmptyName();
    appendScript([
      hostAnswer('local', {typed: '-oProxyCommand=x'}),
      {surface: 'failureDialog', match: 'Could not establish connection', answer: {button: 'Close Remote'}, window: name},
    ]);
    await nextEmptyWindow(() => inWindow('local', 'opensshremotes.openEmptyWindow'));
    await waitFor(
      `the failure dialog of ${name}`,
      () => recordLines('failureDialog', name).length > 0,
      300_000,
    );
    await waitFor(
      `window ${name} to leave its remote`,
      () => windowEvents(name).some(each => each.event === 'deactivated'),
      60_000,
    );
    deepStrictEqual(
      (await statusBarText(name, 'status.host').catch(() => '')).includes('SSH'),
      false,
    );
    await closeWindow(name).catch(() => undefined);
  });

  it('F-2205 AC-25 (c120-more-actions): More Actions... opens its pick, and Escape leaves the window disconnected with no dialog', async () => {
    const name = nextEmptyName();
    appendScript([
      hostAnswer('local', {typed: '-oProxyCommand=x'}),
      {surface: 'failureDialog', match: 'Could not establish connection', answer: {button: 'More Actions...'}, window: name},
      {surface: 'mitigationPick', match: 'Pick an action', answer: 'dismiss', window: name},
    ]);
    await nextEmptyWindow(() => inWindow('local', 'opensshremotes.openEmptyWindow'));
    await waitFor(
      'the mitigation pick',
      () => recordLines('mitigationPick', name).length > 0,
      60_000,
    );
    const pick = recordLines('mitigationPick', name)[0] ?? {
      question: undefined,
      buttons: undefined,
    };
    const indicator = await statusBarText(name, 'status.host').catch(() => '');
    deepStrictEqual(
      {
        placeholder: pick.question,
        noDialogAfter: recordLines('failureDialog', name).length === 1,
        disconnected: indicator.includes('Disconnected from SSH'),
      },
      {
        placeholder: 'Pick an action to help resolve the problem.',
        noDialogAfter: true,
        disconnected: true,
      },
    );
    await closeWindow(name).catch(() => undefined);
  });

  it('F-2205 AC-23 (c120-log): the log names the authority and the check, and nothing is stored for the host', async () => {
    const name = await reject('-oProxyCommand=x');
    try {
      const logLines = connectionLog();
      // Measure: reveal which lines of the Remote - SSH log name the host or the failure.
      deepStrictEqual(
        logLines.filter(
          line =>
            line.includes('oProxyCommand=x') ||
            line.startsWith('Resolving') ||
            line.includes('connect failed') ||
            line.includes('invalidSetting'),
        ),
        ['Resolving ssh-remote+-oProxyCommand=x, attempt 1', 'connect failed: invalidSetting'],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-35 (c120-troubleshooting): a rejected window leaves the session troubleshooting terminal', async () => {
    const name = await reject('-oProxyCommand=x');
    try {
      await waitFor(
        'the troubleshooting terminal',
        async () =>
          (await terminalTabsOf(name)).some(label =>
            label.includes(TROUBLESHOOT),
          ),
        60_000,
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-13 (c120-current-window): Connect Current Window to a forbidden host turns that window remote and shows the host check', async () => {
    const name = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    appendScript([hostAnswer(name, {typed: 'u%x@a`b'})]);
    await inWindow(name, 'opensshremotes.openEmptyWindowInCurrentWindow');
    try {
      await waitFor(
        `the failure dialog of ${name}`,
        () => recordLines('failureDialog', name).length > 0,
        300_000,
      );
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "a`b": SSH host name cannot include the character `.',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-14 (c120-alias): configured aliases with a forbidden name are listed, and each refuses as in AC-2 and AC-4', async () => {
    await withConfig(
      '\nHost -badhost\nHost c120pct%x\n',
      async () => {
        const names: [string, string] = [
          await rejectViaPick('-badhost'),
          await rejectViaPick('c120pct%x'),
        ];
        try {
          deepStrictEqual(
            [
              hostAliases().includes('-badhost') &&
                hostAliases().includes('c120pct%x'),
              failureDialog(names[0]).detail,
              failureDialog(names[1]).detail,
            ],
            [
              true,
              'Could not establish connection to "-badhost": SSH host name cannot begin with -.',
              'Could not establish connection to "c120pct%x": SSH host name cannot include the character %.',
            ],
          );
        } finally {
          await Promise.all(names.map(closeWindow));
        }
      },
    );
  });

  it('F-2205 AC-15 (c120-alias-configured): an alias whose configured value is forbidden is not validated; ssh runs with it', async () => {
    await withConfig(
      '\nHost proxy-al\n  HostName -oProxyCommand=x\n',
      async () => {
        appendScript([pickHost('proxy-al')]);
        const name = await nextEmptyWindow(() =>
          inWindow('local', 'opensshremotes.openEmptyWindow'),
        );
        try {
          await waitFor(
            `the failure dialog of ${name}`,
            () => recordLines('failureDialog', name).length > 0,
            300_000,
          );
          const detail = failureDialog(name).detail ?? '';
          deepStrictEqual(
            [
              detail.includes('cannot begin with'),
              detail.includes('cannot include the character'),
            ],
            [false, false],
          );
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      },
    );
  });

  it('F-2205 AC-16 (c120-link-pct): a link whose decoded authority has a forbidden host shows S120 with that character', async () => {
    const name = 'c120-link-pct';
    await openTo('c120alias-a%25b', name);
    try {
      deepStrictEqual(
        failureDialog(name).detail,
        'Could not establish connection to "c120alias-a%b": SSH host name cannot include the character %.',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-26 (c120-link-user): a link whose authority has a forbidden user names the host part and its character', async () => {
    const [first, second] = [
      await (async () => {
        const name = 'c120-link-u';
        await openTo('-u@c120h', name);
        return {name, detail: failureDialog(name).detail};
      })(),
      await (async () => {
        const name = 'c120-link-p';
        await openTo('u%2521x@c120h', name);
        return {name, detail: failureDialog(name).detail};
      })(),
    ];
    deepStrictEqual(
      [first.detail, second.detail],
      [
        'Could not establish connection to "c120h": SSH user name cannot begin with -.',
        'Could not establish connection to "c120h": SSH user name cannot include the character %.',
      ],
    );
    await Promise.all([first.name, second.name].map(closeWindow));
  });

  it('F-2205 AC-27 (c120-link-buttons): a link window that failed the check carries the same buttons, no other', async () => {
    const name = 'c120-link-btn';
    await openTo('a%b', name);
    try {
      deepStrictEqual(
        [...(failureDialog(name).buttons ?? [])].sort(),
        [...BUTTONS].sort(),
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-28 (c120-alias-reasonless): an alias whose configured value is invalid is not validated; the reason is not an F-2205 check', async () => {
    await withConfig(
      '\nHost c120pval\n  HostName a%b\nHost c120uval\n  HostName a%b\n  User u%x\nHost c120sval\n  HostName a;b\n',
      async () => {
        const seen: string[] = [];
        for (const label of ['c120pval', 'c120uval', 'c120sval']) {
          const name = await rejectViaPick(label);
          try {
            seen.push(failureDialog(name).detail ?? '');
          } finally {
            await closeWindow(name).catch(() => undefined);
          }
        }
        deepStrictEqual(seen, [
          'Could not establish connection to "c120pval".',
          'Could not establish connection to "c120uval".',
          'Could not establish connection to "c120sval": Could not resolve hostname.',
        ]);
      },
    );
  });

  it('F-2205 AC-34 (c120-alias-dash): an alias written with a leading dash refuses in Connect to Host with the host check', async () => {
    await withConfig('\nHost -bad\n', async () => {
      appendScript([pickHost('-bad')]);
      const name = await nextEmptyWindow(() =>
        inWindow('local', 'opensshremotes.openEmptyWindow'),
      );
      try {
        await waitFor(
          `the failure dialog of ${name}`,
          () => recordLines('failureDialog', name).length > 0,
          300_000,
        );
        deepStrictEqual(
          failureDialog(name).detail,
          'Could not establish connection to "-bad": SSH host name cannot begin with -.',
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2205 AC-17, AC-33 (c120-add): Add New SSH Host writes the command as given, with no F-2205 message', async () => {
    const file = variable('HARNESS_SSH_CONFIG');
    const saved = configFile();
    const cases = [
      {command: 'ssh -- -bad', host: '-bad'},
      {command: 'ssh -l -bad h.invalid', host: 'h.invalid', user: '-bad'},
      {command: 'a%b', host: 'a%b'},
      {command: 'u%x@h.invalid', host: 'h.invalid', user: 'u%x'},
    ];
    const results: boolean[] = [];
    try {
      for (const each of cases) {
        const mark = recordLines(undefined, 'local').length;
        appendScript([
          {surface: 'textInput', match: 'Enter SSH Connection Command', answer: {text: each.command}, window: 'local'},
          {surface: 'filePick', match: 'SSH configuration file', answer: {label: file}, window: 'local'},
          {surface: 'notice', match: 'Host added!', answer: 'dismiss', window: 'local'},
        ]);
        await inWindow('local', 'opensshremotes.addNewSshHost');
        const added = recordLines(undefined, 'local').slice(mark);
        results.push(
          added.some(
            line => line.surface === 'notice' && line.question === 'Host added!',
          ) &&
          !added.some(
            line =>
              line.question.includes('cannot begin with') ||
              line.question.includes('cannot include the character'),
          ),
        );
      }
      const text = configFile();
      results.push(
        cases.every(
          each =>
            text.includes(each.host) &&
            (each.user === undefined || text.includes(each.user)),
        ),
      );
      deepStrictEqual(results, [true, true, true, true, true]);
    } finally {
      writeFileSync(file, saved);
    }
  });

  it('F-2205 AC-18, AC-29 (c120-uninstall): Uninstall with a forbidden host fails with the check in its error modal', async () => {
    const seen: Array<[string, string]> = [];
    for (const target of ['-badhost3', 'u!x@h.invalid']) {
      let error = '';
      try {
        await runWith('local', 'opensshremotes.cleanDevBox', [typeHost(target)]);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      seen.push([target, error]);
    }
    deepStrictEqual(seen, [
      ['-badhost3', 'SSH host name cannot begin with -'],
      ['u!x@h.invalid', 'SSH user name cannot include the character !'],
    ]);
  });

  it('F-2205 AC-19, AC-30 (c120-kill): Kill with a forbidden host only says it failed to kill, naming the host without the user', async () => {
    const seen: Array<[string, Array<[string, string[]]>]> = [];
    for (const target of ['a%b', 'u!x@h.invalid'] as const) {
      const mark = recordLines(undefined, 'local').length;
      await runWith('local', 'opensshremotes.cleanRemoteServer', [
        typeHost(target),
        {surface: 'notice', match: 'Failed to kill VS Code Server on', answer: 'dismiss', window: 'local'},
      ]);
      seen.push([target, noticesSince(mark, 'local')]);
    }
    deepStrictEqual(seen, [
      ['a%b', [['Failed to kill VS Code Server on a%b.', ['Open Logs']]]],
      ['u!x@h.invalid', [['Failed to kill VS Code Server on h.invalid.', ['Open Logs']]]],
    ]);
  });

  it('F-2205 AC-20 (c120-kill-local): Kill Local Connection with a forbidden host shows nothing and changes nothing', async () => {
    const mark = recordLines(undefined, 'local').length;
    appendScript([typeHost('-badhost4')]);
    try {
      await inWindow('local', 'opensshremotes.cleanLocalServer');
    } catch {
      // the command ends; the point is what it shows
    }
    const lines = recordLines(undefined, 'local').slice(mark);
    deepStrictEqual(
      lines.some(
        line => line.surface === 'notice' || line.surface === 'failureDialog',
      ),
      false,
    );
  });

  it("F-2205 AC-36 (c120-kill-semi): Uninstall a semicolon host shows core's error; Kill it names the host without a check", async () => {
    let uninstallError = '';
    try {
      await runWith('local', 'opensshremotes.cleanDevBox', [typeHost('a;b')]);
    } catch (caught) {
      uninstallError = caught instanceof Error ? caught.message : String(caught);
    }
    const killMark = recordLines(undefined, 'local').length;
    await runWith('local', 'opensshremotes.cleanRemoteServer', [
      typeHost('a;b'),
      {surface: 'notice', match: 'Failed to kill VS Code Server on', answer: 'dismiss', window: 'local'},
    ]);
    deepStrictEqual(
      [
        uninstallError,
        noticesSince(killMark, 'local'),
      ],
      [
        'Failed to run command',
        [['Failed to kill VS Code Server on a;b.', ['Open Logs']]],
      ],
    );
  });

  it('F-2205 AC-37 (c120-control): a host carrying a control character fails the check naming the code point, so no ssh is started', async () => {
    const before = (await connectionHelpers()).length;
    const name = 'c120-control';
    await openWindow('c120ctl%0A', name);
    try {
      const detail = failureDialog(name).detail ?? '';
      deepStrictEqual(
        [
          detail,
          (await connectionHelpers()).length - before,
        ],
        [
          'Could not establish connection to "c120ctl": SSH host name cannot include the character U+000A.',
          0,
        ],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2205 AC-24 (c120-valid): a valid alias proceeds normally, so no validation dialog appears', async () => {
    const name = 'c120-valid';
    await openWindow('harness', name);
    await connectedWithin(name, INSTALL_MILLISECONDS);
    try {
      deepStrictEqual(
        [
          recordLines('failureDialog', name).length,
          (await statusBarText(name, 'status.host')).includes('SSH'),
        ],
        [0, true],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
