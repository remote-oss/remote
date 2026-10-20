import {chmodSync, mkdirSync, utimesSync} from 'node:fs';
import {deepStrictEqual} from 'node:assert';
import {closeAllButLocal} from '../windows/maintenance.ts';
import path from 'node:path';
import {appendScript, connectionLog} from '../windows/harness.ts';
import {
  answerEntry,
  dialogLines,
  dismissals,
  failureOf,
  fixtureFolder,
  logSince,
  markerOf,
  openConnected,
  withSetting,
  writeScript,
} from './support.ts';

/** The questions the dialog of window `window` was shown with. */
function asked(window: string): string[] {
  return dialogLines(window)
    .filter(line => line.held !== true)
    .map(line => line.question);
}

const PLAIN = 'Execute pre-connection script?';
const CHANGED = 'Pre-connection script has changed since last confirmation';

describe('the pre-connection scripts the user trusts (card connect-87)', function () {
  this.timeout(300_000);

  afterEach(closeAllButLocal);

  it("F-2108 AC-13, AC-14 (changed): changed contents ask again with the message that says so; Allow keeps asking and Don't Ask Again stops it", async () => {
    const script = writeScript('changed.sh', 'echo one >> "$MARKER"');
    appendScript([
      answerEntry('pc14a', "Allow and Don't Ask Again"),
      answerEntry('pc14b', 'Allow'),
      answerEntry('pc14c', 'Allow'),
      answerEntry('pc14d', "Allow and Don't Ask Again"),
    ]);
    const mark = connectionLog().length;
    await withSetting(script, async () => {
      await openConnected('pc14a');
      writeScript('changed.sh', 'echo two >> "$MARKER"');
      await openConnected('pc14b');
      await openConnected('pc14c');
      await openConnected('pc14d');
      await openConnected('pc14e');
    });
    deepStrictEqual(
      [
        ['pc14a', 'pc14b', 'pc14c', 'pc14d', 'pc14e'].map(asked),
        logSince(mark).filter(line => line.includes('contents have changed'))
          .length,
        markerOf(script),
      ],
      [
        [[PLAIN], [CHANGED], [CHANGED], [CHANGED], []],
        3,
        'one\ntwo\ntwo\ntwo\ntwo\n',
      ],
    );
  });

  it('F-2108 AC-15 (object): an object keyed by the alias runs; a key in another case, and a pattern, ask nothing', async () => {
    const script = writeScript('keyed.sh', 'echo ran >> "$MARKER"');
    const other = writeScript('other-case.sh', 'echo ran >> "$MARKER"');
    appendScript([answerEntry('pc15a', 'Allow')]);
    await withSetting({harness: script}, () => openConnected('pc15a'));
    await withSetting({Harness: other, '*': other}, () =>
      openConnected('pc15b'),
    );
    deepStrictEqual(
      [asked('pc15a'), asked('pc15b'), markerOf(script), markerOf(other)],
      [[PLAIN], [], 'ran\n', undefined],
    );
  });

  it('F-2108 AC-29 (python): an executable file with an interpreter line of its own runs, whatever its name', async () => {
    const script = writeScript('named.py', 'echo ran > "$MARKER"');
    appendScript([answerEntry('pc29', 'Allow')]);
    await withSetting(script, () => openConnected('pc29'));
    deepStrictEqual(markerOf(script), 'ran\n');
  });

  it("F-2108 AC-36 (unreadable): Don't Ask Again on a missing path, a folder and a file without read permission fails with the file read's detail, runs nothing, and the next connect asks again", async () => {
    const missing = path.join(fixtureFolder(), 'gone-36.sh');
    const folder = path.join(fixtureFolder(), 'folder-36');
    mkdirSync(folder, {recursive: true});
    const locked = writeScript('locked-36.sh', 'echo ran > "$MARKER"', 0o000);
    appendScript([
      ...['a', 'b', 'c'].flatMap(letter => [
        answerEntry(`pc36${letter}`, "Allow and Don't Ask Again"),
        ...dismissals(`pc36${letter}`),
      ]),
    ]);
    const details = [];
    for (const [letter, target] of [
      ['a', missing],
      ['b', folder],
      ['c', locked],
    ] as const) {
      details.push(
        (await withSetting(target, () => failureOf(`pc36${letter}`))).question,
      );
    }
    chmodSync(locked, 0o755);
    deepStrictEqual(
      [details, markerOf(locked), markerOf(missing)],
      [
        [
          `Could not establish connection to "harness": ENOENT: no such file or directory, open '${missing}'.`,
          `Could not establish connection to "harness": EISDIR: illegal operation on a directory, read.`,
          `Could not establish connection to "harness": EACCES: permission denied, open '${locked}'.`,
        ],
        undefined,
        undefined,
      ],
    );
  });

  it('F-2108 AC-37 (space): a path with a space is shown unchanged and runs', async () => {
    const script = writeScript('with space.sh', 'echo ran > "$MARKER"');
    appendScript([answerEntry('pc37', 'Allow')]);
    await withSetting(script, () => openConnected('pc37'));
    deepStrictEqual(
      [
        dialogLines('pc37')
          .filter(line => line.held !== true)
          .map(line => line.detail),
        markerOf(script),
      ],
      [[`'${script}' will be executed on your local machine.`], 'ran\n'],
    );
  });

  it('F-2108 AC-38 (stdin): a script that reads its input gets the end of it and the connect goes on', async () => {
    const script = writeScript(
      'reads.sh',
      'read line\necho "done:$line" > "$MARKER"',
    );
    appendScript([answerEntry('pc38', 'Allow')]);
    await withSetting(script, () => openConnected('pc38'));
    deepStrictEqual(markerOf(script), 'done:\n');
  });

  it('F-2108 AC-39 (touched): a confirmed script whose modification time changed, with the same contents, runs with no dialog', async () => {
    const script = writeScript('touched.sh', 'echo ran >> "$MARKER"');
    appendScript([answerEntry('pc39a', "Allow and Don't Ask Again")]);
    await withSetting(script, async () => {
      await openConnected('pc39a');
      utimesSync(script, new Date(2020, 0, 1), new Date(2020, 0, 1));
      await openConnected('pc39b');
    });
    deepStrictEqual(
      [asked('pc39a'), asked('pc39b'), markerOf(script)],
      [[PLAIN], [], 'ran\nran\n'],
    );
  });
});
