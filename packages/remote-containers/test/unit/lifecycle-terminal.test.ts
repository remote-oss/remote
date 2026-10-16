import {deepStrictEqual} from 'node:assert';
import type {StdinPresentation} from '../../src/cli/cli-host.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import {
  lifecyclePresenterOf,
  type StatusProgressPort,
  type TerminalPort,
} from '../../src/surfaces/lifecycle-terminal.ts';

const S153 = '\r\n\u001b[1mDone. Press any key to close the terminal.\u001b[0m';

/**
 * Fakes of the editor's terminals and window progress, with a record of what the presenter did to them. A key or a
 * close goes to the last terminal opened, or to the one `index` names.
 */
function sceneOf(translate = (template: string) => template) {
  const record: string[] = [];
  const inputs: Array<(data: string) => void> = [];
  const closers: Array<() => void> = [];
  const terminal: TerminalPort = {
    open: (name, onInput, onClosed) => {
      record.push(`open ${name}`);
      const index = inputs.length;
      inputs.push(onInput);
      closers.push(onClosed);
      return {
        write: text => record.push(`write ${JSON.stringify(text)}`),
        close: () =>
          record.push(index === 0 ? 'close' : `close ${String(index)}`),
      };
    },
  };
  const progress: StatusProgressPort = {
    show: title => {
      record.push(`show ${title}`);
      return () => record.push('hide');
    },
  };
  const presenter = lifecyclePresenterOf(terminal, progress, translate);
  return {
    record,
    presenter,
    typed: (data: string, index = inputs.length - 1) =>
      inputs.at(index)?.(data),
    userCloses: (index = closers.length - 1) => closers.at(index)?.(),
    /** Hands the writer for the run's CLI stdin to the presenter, as a CLI run does. */
    attach: (
      write: (data: string) => void,
      presentation: StdinPresentation,
    ) => {
      presenter.attachStdin(write, presentation);
    },
  };
}

/** A `postCreate` event of this type and text. */
function eventOf(
  type: 'raw' | 'start' | 'stop' | 'text',
  text: string,
): Extract<CliEvent, {kind: 'log'}> {
  return {
    kind: 'log',
    level: 3,
    text,
    channel: 'postCreate',
    type,
    timestamp: 100,
    startTimestamp: type === 'stop' ? 90 : undefined,
  };
}

describe('the "Configuring..." terminal (card containers-20)', () => {
  it('F-0415 AC-35: no events, no terminal and no S085', () => {
    const scene = sceneOf();
    scene.presenter.backgroundStarted();
    scene.presenter.ended();
    deepStrictEqual(scene.record, []);
  });

  it('F-0415 AC-35: the terminal opens on the first raw or start, once, and writes what came before it', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('text', 'early\n'), 0);
    scene.presenter.output(eventOf('stop', 'Run: x'), 0);
    const beforeRaw = [...scene.record];
    scene.presenter.output(eventOf('raw', 'out\n'), 0);
    scene.presenter.output(eventOf('raw', 'more\n'), 0);
    deepStrictEqual(
      [beforeRaw, scene.record],
      [
        [],
        [
          'open Configuring...',
          `write ${JSON.stringify('early\r\n\u001b[90m[100 ms] Stop (10 ms)\u001b[0m: Run: x\r\nout\r\n')}`,
          `write ${JSON.stringify('more\r\n')}`,
        ],
      ],
    );
  });

  it('remote-oss/remote-containers#126: a raw prompt with no newline is written at once, and the echo of its answer follows it on its line', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'Open the URL? [Y/n] > '), 0);
    scene.attach(() => undefined, 'plain');
    scene.typed('y');
    deepStrictEqual(scene.record, [
      'open Configuring...',
      `write ${JSON.stringify('Open the URL? [Y/n] > ')}`,
      `write ${JSON.stringify('y')}`,
    ]);
  });

  /** A scene whose run has emitted the raw line `a\n` and captures every key its stdin writer would get. */
  function stdinScene(presentation: StdinPresentation = 'plain') {
    const scene = sceneOf();
    const delivered: string[] = [];
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.attach(data => delivered.push(data), presentation);
    return {scene, delivered};
  }

  it('F-0415 AC-35: a start opens it too', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('start', 'Run: x'), 40);
    deepStrictEqual(scene.record, [
      'open Configuring...',
      `write ${JSON.stringify('\u001b[90m[60 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run: x\r\n')}`,
    ]);
  });

  it('F-0415 7.E6: the printable keys of a run are echoed and held in the run line, which the child has not seen yet', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('b');
    deepStrictEqual(
      [scene.record.slice(1), delivered],
      [
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('b')}`,
        ],
        [],
      ],
    );
  });

  it('F-0415 7.E6: Enter hands the run line, with its CR, to the run stdin, and the terminal shows the newline', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('ab\r');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['ab\r'],
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('b')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
      ],
    );
  });

  it('F-0415 7.E6: a tab is echoed and held like a printable key, and reaches the child in the line', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('\t');
    scene.typed('\r');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['a\t\r'],
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('\t')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
      ],
    );
  });

  it('F-0415 7.E6: a backspace pops a whole character, not a code unit of an astral character', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a\u{1F600}');
    scene.typed('\x7f');
    scene.typed('\r');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['a\r'],
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('\u{1F600}')}`,
          `write ${JSON.stringify('\u0008 \u0008')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
      ],
    );
  });

  it('F-0415 7.E6: a lone Escape goes raw, and the Enter after it still ends the run line', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('\x1b');
    scene.typed('\r');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['\x1b', 'a\r'],
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
      ],
    );
  });

  it('F-0415 7.E6: a lone Escape loses no letter that follows it', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('\x1b');
    scene.typed('b');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['\x1b'],
        [`write ${JSON.stringify('a\r\n')}`, `write ${JSON.stringify('b')}`],
      ],
    );
  });

  it('F-0415 7.E6: a backspace pops the run line and redisplay-erases its echo', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('b');
    scene.typed('\x7f');
    scene.typed('\r');
    deepStrictEqual(
      [scene.record.slice(1), delivered],
      [
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('b')}`,
          `write ${JSON.stringify('\u0008 \u0008')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
        ['a\r'],
      ],
    );
  });

  it('F-0415 7.E6: a backspace on the empty run line redisplay-erases nothing and sends an empty line', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('\x7f');
    scene.typed('\r');
    deepStrictEqual(
      [scene.record, delivered],
      [
        [
          'open Configuring...',
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
        ['\r'],
      ],
    );
  });

  it('F-0415 7.E6: a forward delete sequence is swallowed, and its line still ends on Enter', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('\u001b[3~');
    scene.typed('\r');
    deepStrictEqual(
      [scene.record.slice(1), delivered],
      [
        [
          `write ${JSON.stringify('a\r\n')}`,
          `write ${JSON.stringify('a')}`,
          `write ${JSON.stringify('\r\n')}`,
        ],
        ['a\r'],
      ],
    );
  });

  it('F-0415 7.E6: a control key of a run, the Ctrl+C among them, goes raw to the run stdin at once', () => {
    const {scene, delivered} = stdinScene();
    scene.typed('a');
    scene.typed('\u0003');
    deepStrictEqual(
      [scene.record.slice(1), delivered],
      [
        [`write ${JSON.stringify('a\r\n')}`, `write ${JSON.stringify('a')}`],
        ['\u0003'],
      ],
    );
  });
  it('F-0415 7.E6: a key with no run stdin is echoed and goes nowhere', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.typed('a');
    scene.typed('\u0003');
    deepStrictEqual(scene.record, [
      'open Configuring...',
      `write ${JSON.stringify('a\r\n')}`,
      `write ${JSON.stringify('a')}`,
    ]);
  });

  it('F-0415 7.E6: an echoed run forwards each key, a line and a control key, raw to its stdin', () => {
    const {scene, delivered} = stdinScene('echoed');
    scene.typed('ab');
    scene.typed('\r');
    scene.typed('\u0003');
    scene.typed('\u001b[3~');
    deepStrictEqual(
      [delivered, scene.record.slice(1)],
      [
        ['ab', '\r', '\u0003', '\u001b[3~'],
        [`write ${JSON.stringify('a\r\n')}`],
      ],
    );
  });

  it('F-0415 7.E6, AC-33: an echoed run forwards until it ends, and the next key after the end closes it', () => {
    const {scene, delivered} = stdinScene('echoed');
    scene.typed('x');
    scene.presenter.ended();
    scene.typed('y');
    deepStrictEqual(
      [delivered, scene.record.slice(2)],
      [['x'], [`write ${JSON.stringify(S153)}`, 'close']],
    );
  });

  it('F-0415 7.E6, AC-33: after the run has ended, a key closes the terminal and goes nowhere', () => {
    const {scene, delivered} = stdinScene();
    scene.presenter.ended();
    scene.typed('x');
    deepStrictEqual(
      [scene.record.slice(2), delivered],
      [[`write ${JSON.stringify(S153)}`, 'close'], []],
    );
  });

  it('F-0415 7.E6: a run after an ended run gets its own stdin, and a key of the old terminal closes it alone', () => {
    const scene = sceneOf();
    const first: string[] = [];
    const second: string[] = [];
    scene.presenter.output(eventOf('raw', 'one\n'), 0);
    scene.attach(data => first.push(data), 'plain');
    scene.presenter.ended();
    scene.presenter.backgroundStarted();
    scene.presenter.output(eventOf('raw', 'two\n'), 0);
    scene.attach(data => second.push(data), 'plain');
    scene.typed('y\r', 1);
    scene.typed('z', 0);
    deepStrictEqual(
      [
        [first, second],
        scene.record.slice(
          scene.record.indexOf(`write ${JSON.stringify('two\r\n')}`) + 1,
        ),
      ],
      [
        [[], ['y\r']],
        [
          `write ${JSON.stringify('y')}`,
          `write ${JSON.stringify('\r\n')}`,
          'close',
        ],
      ],
    );
  });

  it('F-0415 AC-33: the end writes S153 in bold, and the next key closes the terminal', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.presenter.ended();
    scene.typed('x');
    deepStrictEqual(scene.record.slice(2), [
      `write ${JSON.stringify(S153)}`,
      'close',
    ]);
  });

  it('F-0415 AC-6, AC-38: S085 shows from the background’s first output until the run ends, and a run that never ends keeps it', () => {
    const ending = sceneOf();
    ending.presenter.backgroundStarted();
    const beforeOutput = [...ending.record];
    ending.presenter.output(eventOf('raw', 'a\n'), 0);
    ending.presenter.output(eventOf('raw', 'b\n'), 0);
    ending.presenter.ended();
    const unfinished = sceneOf();
    unfinished.presenter.backgroundStarted();
    unfinished.presenter.output(eventOf('start', 'Run: x'), 0);
    deepStrictEqual(
      [
        beforeOutput,
        ending.record.filter(line => !line.startsWith('write')),
        unfinished.record.filter(line => !line.startsWith('write')),
      ],
      [
        [],
        [
          'show Configuring Dev Container (show log)',
          'open Configuring...',
          'hide',
        ],
        ['show Configuring Dev Container (show log)', 'open Configuring...'],
      ],
    );
  });

  it('F-0415 5.0 step 10: an output of up shows no S085', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'on-create\n'), 0);
    deepStrictEqual(scene.record, [
      'open Configuring...',
      `write ${JSON.stringify('on-create\r\n')}`,
    ]);
  });

  it('F-0415 5.0 step 10: a run after an ended run opens its own terminal, and a key closes the first alone', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'one\n'), 0);
    scene.presenter.ended();
    scene.presenter.backgroundStarted();
    scene.presenter.output(eventOf('raw', 'two\n'), 0);
    scene.typed('x', 1);
    const secondKey = [...scene.record];
    scene.typed('x', 0);
    deepStrictEqual(
      [secondKey, scene.record.slice(secondKey.length)],
      [
        [
          'open Configuring...',
          `write ${JSON.stringify('one\r\n')}`,
          `write ${JSON.stringify(S153)}`,
          'show Configuring Dev Container (show log)',
          'open Configuring...',
          `write ${JSON.stringify('two\r\n')}`,
          // A key of the unfinished run is echoed (F-0415 7.E6).
          `write ${JSON.stringify('x')}`,
        ],
        ['close'],
      ],
    );
  });

  it('F-0415 5.0 step 10: a run after one whose terminal the user closed opens a terminal again', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'one\n'), 0);
    scene.userCloses();
    scene.presenter.ended();
    scene.presenter.output(eventOf('raw', 'two\n'), 0);
    deepStrictEqual(scene.record.slice(2), [
      'open Configuring...',
      `write ${JSON.stringify('two\r\n')}`,
    ]);
  });

  it('F-0415 AC-37: a terminal the user closed is not reopened, later events are dropped, and S085 stays until the end', () => {
    const scene = sceneOf();
    scene.presenter.backgroundStarted();
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.userCloses();
    scene.presenter.output(eventOf('raw', 'b\n'), 0);
    const afterClose = [...scene.record];
    scene.presenter.ended();
    deepStrictEqual(
      [afterClose, scene.record.slice(afterClose.length)],
      [
        [
          'show Configuring Dev Container (show log)',
          'open Configuring...',
          `write ${JSON.stringify('a\r\n')}`,
        ],
        ['hide'],
      ],
    );
  });

  it('F-0415 AC-33: a key before the end does not close it, and S153 goes to a terminal that is open only', () => {
    const scene = sceneOf();
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.userCloses();
    scene.presenter.ended();
    scene.typed('x');
    deepStrictEqual(scene.record.slice(2), []);
  });

  it('contracts: the names and titles are translated', () => {
    const scene = sceneOf(template => `<${template}>`);
    scene.presenter.backgroundStarted();
    scene.presenter.output(eventOf('raw', 'a\n'), 0);
    scene.presenter.ended();
    deepStrictEqual(
      [scene.record[0], scene.record[1], scene.record[4]],
      [
        'show <Configuring Dev Container (show log)>',
        'open <Configuring...>',
        `write ${JSON.stringify(S153.replace('Done. Press any key to close the terminal.', '<Done. Press any key to close the terminal.>'))}`,
      ],
    );
  });
});
