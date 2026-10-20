import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectionLog,
  recordLines,
  variable,
} from '../windows/harness.ts';
import {closeAllButLocal, settingsText} from '../windows/maintenance.ts';
import {
  answerEntry,
  dialogLines,
  markerOf,
  openConnected,
  withSetting,
  writeScript,
} from './support.ts';

/** The progress texts of window `window`, in the order shown. */
function progressOf(window: string): string[] {
  return recordLines('progress', window).map(line => line.question);
}

describe('the pre-connection script of a connect (card connect-87)', function () {
  this.timeout(300_000);

  afterEach(closeAllButLocal);

  it('F-2108 AC-2 (unset): with no script no dialog is shown and the script stage is not', async () => {
    await openConnected('pc2');
    deepStrictEqual(
      [
        dialogLines('pc2').length,
        progressOf('pc2').some(text => text.includes('pre-connection')),
      ],
      [0, false],
    );
  });

  it('F-2108 AC-3, AC-4 (dialog): the script stage shows before the dialog, which names the path and offers three buttons', async () => {
    const script = writeScript('dialog.sh', 'echo ran > "$MARKER"');
    appendScript([answerEntry('pc3', 'Allow')]);
    await withSetting(script, () => openConnected('pc3'));
    const shown = dialogLines('pc3').filter(line => line.held !== true);
    const stage = recordLines(undefined, 'pc3').findIndex(line =>
      line.question.startsWith('Running pre-connection script'),
    );
    const asked = recordLines(undefined, 'pc3').findIndex(
      line => line.surface === 'preconnectDialog',
    );
    deepStrictEqual(
      [
        shown.map(line => [line.question, line.detail, line.buttons]),
        stage !== -1 && stage < asked,
        [
          ...new Set(
            progressOf('pc3').filter(text => text.startsWith('Running')),
          ),
        ],
      ],
      [
        [
          [
            'Execute pre-connection script?',
            `'${script}' will be executed on your local machine.`,
            ['Allow', "Allow and Don't Ask Again", 'Skip'],
          ],
        ],
        true,
        [
          'Running pre-connection script ([show log](command:opensshremotes.showLog "Show log"))',
        ],
      ],
    );
  });

  it('F-2108 AC-6, AC-7 (allow): Allow runs the script with no arguments, no terminal, the editor environment and its output in the log before the probe', async () => {
    const script = writeScript(
      'allow.sh',
      [
        'echo "$#" > "$MARKER"',
        'pwd >> "$MARKER"',
        'if [ -t 0 ]; then echo tty >> "$MARKER"; else echo notty >> "$MARKER"; fi',
        'echo "$REMOTE_OSS_F2108_VARIABLE" >> "$MARKER"',
        'echo from-stdout',
        'echo from-stderr >&2',
      ].join('\n'),
    );
    appendScript([answerEntry('pc6', 'Allow')]);
    const mark = connectionLog().length;
    await withSetting(script, () => openConnected('pc6'));
    const lines = connectionLog().slice(mark);
    const last = lines.findLastIndex(line => line.includes('[preconnect'));
    const probing = lines.findIndex(line => line.startsWith('Server result'));
    deepStrictEqual(
      [
        markerOf(script)?.split('\n'),
        lines.filter(line => line.includes('[preconnect')),
        last < probing,
      ],
      [
        [
          '0',
          process.cwd(),
          'notty',
          variable('REMOTE_OSS_F2108_VARIABLE'),
          '',
        ],
        ['[preconnect] from-stdout', '[preconnect (stderr)] from-stderr'],
        true,
      ],
    );
  });

  it('F-2108 AC-10 (skip): Skip, and a dismissed dialog, run nothing, log the skip, connect and show no notice', async () => {
    const script = writeScript('skip.sh', 'echo ran > "$MARKER"');
    appendScript([
      answerEntry('pc10a', 'Skip'),
      answerEntry('pc10b', 'dismiss'),
    ]);
    const noticesBefore = recordLines('notice').length;
    await withSetting(script, async () => {
      await openConnected('pc10a');
      await openConnected('pc10b');
    });
    deepStrictEqual(
      [
        markerOf(script),
        connectionLog().filter(line =>
          line.includes('the user skipped the pre-connection script'),
        ).length,
        recordLines('notice').length - noticesBefore,
      ],
      [undefined, 2, 0],
    );
  });

  it("F-2108 AC-11, AC-12 (remember): Don't Ask Again runs it, and another window to another alias runs it with no dialog, the settings file unchanged", async () => {
    const script = writeScript('remember.sh', 'echo ran >> "$MARKER"');
    appendScript([answerEntry('pc11', "Allow and Don't Ask Again")]);
    let written = '';
    let after = '';
    await withSetting(script, async () => {
      written = settingsText();
      await openConnected('pc11');
      after = settingsText();
      await openConnected('pc12', '127.0.0.1');
    });
    deepStrictEqual(
      [
        dialogLines('pc11').filter(line => line.held !== true).length,
        dialogLines('pc12').length,
        markerOf(script),
        after === written,
      ],
      [1, 0, 'ran\nran\n', true],
    );
  });
});
