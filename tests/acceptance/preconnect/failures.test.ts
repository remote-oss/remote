import {deepStrictEqual} from 'node:assert';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  waitFor,
} from '../windows/harness.ts';
import {tableShown} from '../windows/troubleshooting-support.ts';
import {
  answerEntry,
  dialogLines,
  dismissals,
  failureOf,
  fixtureFolder,
  logSince,
  markerOf,
  withSetting,
  writeScript,
} from './support.ts';

/** The question of a failure dialog on the host `harness` with this text after the host's name. */
function failedWith(text: string): string {
  return `Could not establish connection to "harness": ${text}.`;
}

describe('the pre-connection script that fails the connect (card connect-87)', function () {
  this.timeout(300_000);

  afterEach(closeAllButLocal);

  it('F-2108 AC-19, AC-21 (exit-one): a script that exits with 1 fails the connect with the status, the dialog offers the three buttons, and the log has the output, the error and the summary', async () => {
    const script = writeScript(
      'exit-one.sh',
      'echo out-line\necho err-line >&2\nexit 1',
    );
    appendScript([answerEntry('pf19', 'Allow'), ...dismissals('pf19')]);
    const mark = connectionLog().length;
    const dialog = await withSetting(script, () => failureOf('pf19'));
    deepStrictEqual(
      [
        dialog.question,
        dialog.buttons,
        logSince(mark).filter(
          line =>
            line.includes('[preconnect') ||
            line.includes('the pre-connection script failed') ||
            line.includes('[PreconnectScriptFailure]'),
        ),
      ],
      [
        failedWith('non-zero exit code 1'),
        ['Close Remote', 'Retry', 'More Actions...'],
        [
          '[preconnect] out-line',
          '[preconnect (stderr)] err-line',
          'the pre-connection script failed: non-zero exit code 1',
          '[PreconnectScriptFailure]: The pre-connect script has failed (non-zero exit code 1)',
        ],
      ],
    );
  });

  it('F-2108 AC-22 (retry): Retry asks again', async () => {
    const script = writeScript('retry.sh', 'echo ran >> "$MARKER"\nexit 1');
    appendScript([
      answerEntry('pf22', 'Allow'),
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window: 'pf22',
      },
      answerEntry('pf22', 'Skip'),
    ]);
    await withSetting(script, async () => {
      await openWindow('harness', 'pf22');
      await connectedWithin('pf22', 120_000);
    });
    deepStrictEqual(
      [
        recordLines('preconnectDialog', 'pf22').filter(
          line => line.held !== true,
        ).length,
        markerOf(script),
      ],
      [2, 'ran\n'],
    );
  });

  it("F-2108 AC-23 (retry-remembered): after Don't Ask Again on a failing script, Retry runs it with no dialog", async () => {
    const script = writeScript(
      'retry-always.sh',
      'echo ran >> "$MARKER"\nexit 1',
    );
    appendScript([
      answerEntry('pf23', "Allow and Don't Ask Again"),
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window: 'pf23',
      },
      ...dismissals('pf23'),
    ]);
    await withSetting(script, async () => {
      await openWindow('harness', 'pf23');
      await waitFor(
        'the second failure dialog of pf23',
        () => recordLines('failureDialog', 'pf23').length >= 2,
        180_000,
      );
    });
    deepStrictEqual(
      [
        recordLines('preconnectDialog', 'pf23').filter(
          line => line.held !== true,
        ).length,
        markerOf(script),
      ],
      [1, 'ran\nran\n'],
    );
  });

  it('F-2108 AC-24 (signal): a script killed by a signal fails the connect with the signal detail', async () => {
    const script = writeScript('signal.sh', 'kill -9 $$');
    appendScript([answerEntry('pf24', 'Allow'), ...dismissals('pf24')]);
    const dialog = await withSetting(script, () => failureOf('pf24'));
    const {first} = await tableShown('pf24');
    deepStrictEqual(
      [dialog.question, first.slice(0, 2)],
      [
        failedWith('ended by a signal'),
        [
          'PreconnectScriptFailure',
          'The pre-connect script has failed (ended by a signal)',
        ],
      ],
    );
  });

  it('F-2108 AC-25 (not-executable): a file without the execute permission, and a folder, fail with the system’s spawn error and run nothing', async () => {
    const plain = writeScript('plain.sh', 'echo ran > "$MARKER"', 0o644);
    const folder = path.join(fixtureFolder(), 'a-folder');
    mkdirSync(folder, {recursive: true});
    appendScript([
      answerEntry('pf25a', 'Allow'),
      ...dismissals('pf25a'),
      answerEntry('pf25b', 'Allow'),
      ...dismissals('pf25b'),
    ]);
    const questions = [
      (await withSetting(plain, () => failureOf('pf25a'))).question,
      (await withSetting(folder, () => failureOf('pf25b'))).question,
    ];
    // A long path wraps inside its cell, so the cell is compared without its spaces.
    const {first} = await tableShown('pf25b');
    deepStrictEqual(
      [questions, markerOf(plain), first[0], first[1]?.replaceAll(' ', '')],
      [
        [
          failedWith(`spawn ${plain} EACCES`),
          failedWith(`spawn ${folder} EACCES`),
        ],
        undefined,
        'PreconnectScriptFailure',
        `Thepre-connectscripthasfailed(spawn${folder}EACCES)`.replaceAll(
          ' ',
          '',
        ),
      ],
    );
  });

  it('F-2108 AC-18, AC-26 (missing): a path that does not exist is asked about first, and then fails as not found; a relative one is named as written', async () => {
    const missing = path.join(fixtureFolder(), 'does-not-exist.sh');
    appendScript([
      answerEntry('pf26a', 'Allow'),
      ...dismissals('pf26a'),
      answerEntry('pf26b', 'Allow'),
      ...dismissals('pf26b'),
    ]);
    const absolute = await withSetting(missing, () => failureOf('pf26a'));
    const relative = await withSetting('f2108-missing.sh', () =>
      failureOf('pf26b'),
    );
    deepStrictEqual(
      [
        absolute.question,
        relative.question,
        dialogLines('pf26a').filter(line => line.held !== true).length,
      ],
      [
        failedWith(`script not found: ${missing}`),
        failedWith('script not found: f2108-missing.sh'),
        1,
      ],
    );
  });

  it('F-2108 AC-27 (not-a-path): a number or true as the entry fails with no dialog and the PreconnectScriptFailure row, the detail naming the host and the kind and the dialog ending in the single period', async () => {
    appendScript([...dismissals('pf27a'), ...dismissals('pf27b')]);
    const seen: Array<
      [string, number, string | undefined, string | undefined]
    > = [];
    for (const [name, value] of [
      ['pf27a', 7],
      ['pf27b', true],
    ] as const) {
      const dialog = await withSetting({harness: value}, () => failureOf(name));
      // The detail wraps inside its cell, so the cell is compared without its spaces.
      const {first} = await tableShown(name);
      seen.push([
        dialog.question,
        dialogLines(name).length,
        first[0],
        first[1]?.replaceAll(' ', ''),
      ]);
    }
    function detail(kind: string): string {
      return `The value of remote.SSH.preconnect for "harness" is a ${kind}, not the path of a script`;
    }
    deepStrictEqual(seen, [
      [
        failedWith(detail('number')),
        0,
        'PreconnectScriptFailure',
        `The pre-connect script has failed (${detail('number')})`.replaceAll(
          ' ',
          '',
        ),
      ],
      [
        failedWith(detail('boolean')),
        0,
        'PreconnectScriptFailure',
        `The pre-connect script has failed (${detail('boolean')})`.replaceAll(
          ' ',
          '',
        ),
      ],
    ]);
  });

  it('F-2108 AC-20 (table): a script that exits with 1 leaves the PreconnectScriptFailure row of the troubleshooting table with its message and the three mitigations in order', async () => {
    const script = writeScript('table-exit-one.sh', 'exit 1');
    appendScript([answerEntry('pf20', 'Allow'), ...dismissals('pf20')]);
    await withSetting(script, () => failureOf('pf20'));
    const before = readUserSettings();
    const {header, first} = await tableShown('pf20');
    // A long cell wraps inside its column, so the mitigations are compared without their spaces.
    deepStrictEqual(
      [
        header,
        first[0],
        first[1],
        first[2]?.replaceAll(' ', ''),
        readUserSettings(),
      ],
      [
        ['Status', 'Message', 'Mitigations'],
        'PreconnectScriptFailure',
        'The pre-connect script has failed (non-zero exit code 1)',
        '•Updatetheremote.SSH.preconnectsetting•Ensuretheprovidedpathisexecutableandthescriptexitssuccessfully(exitcode0)•ChecktheRemote-SSHlogforoutputfromthescript(prefixedwith[preconnect])',
        before,
      ],
    );
  });
});
