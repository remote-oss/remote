import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseLogLine, type CliEvent} from '../../src/cli/cli-lines.ts';
import {
  lifecycleTextOf,
  terminalLines,
} from '../../src/lifecycle/lifecycle-text.ts';

type LogEvent = Extract<CliEvent, {kind: 'log'}>;

/** The epoch millisecond the recorded run counts from: 109 ms before its first event. */
const RUN_START = 1792012694000;

/** The events of the recorded run of all six hooks (the pinned CLI 0.89.0), in order. */
function recordedRun(): LogEvent[] {
  return readFileSync(
    path.join(
      import.meta.dirname,
      '..',
      'fixtures',
      'devcontainers-cli-0.89.0',
      'lifecycle-events.jsonl',
    ),
    'utf8',
  )
    .split('\n')
    .filter(line => line !== '')
    .map(parseLogLine)
    .flatMap(event => (event.kind === 'log' ? [event] : []));
}

/** A log event of the channel with these facts. */
function eventOf(facts: Partial<LogEvent>): LogEvent {
  return {
    kind: 'log',
    level: 3,
    text: '',
    channel: 'postCreate',
    type: 'raw',
    timestamp: undefined,
    startTimestamp: undefined,
    ...facts,
  };
}

describe('the text of the "Configuring..." terminal (card containers-20)', () => {
  it("F-0415 AC-35: the six hooks' Start and Stop lines in order, with the time since the run began and the duration in parentheses", () => {
    deepStrictEqual(
      recordedRun()
        .filter(event => event.type === 'start' || event.type === 'stop')
        .map(event => lifecycleTextOf(event, RUN_START)),
      [
        '\u001b[90m[109 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run: /bin/sh -c echo init-host\r\n',
        '\u001b[90m[110 ms] Stop (1 ms)\u001b[0m: Run: /bin/sh -c echo init-host\r\n',
        '\u001b[90m[534 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run in container: /bin/sh -c echo on-create\r\n',
        '\u001b[90m[566 ms] Stop (32 ms)\u001b[0m: Run in container: /bin/sh -c echo on-create\r\n',
        '\u001b[90m[567 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run in container: /bin/sh -c echo update-content\r\n',
        '\u001b[90m[600 ms] Stop (33 ms)\u001b[0m: Run in container: /bin/sh -c echo update-content\r\n',
        '\u001b[90m[4938 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run in container: /bin/sh -c echo post-create; echo second line\r\n',
        '\u001b[90m[4972 ms] Stop (34 ms)\u001b[0m: Run in container: /bin/sh -c echo post-create; echo second line\r\n',
        '\u001b[90m[4973 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run in container: /bin/sh -c echo post-start\r\n',
        '\u001b[90m[5003 ms] Stop (30 ms)\u001b[0m: Run in container: /bin/sh -c echo post-start\r\n',
        '\u001b[90m[5003 ms] \u001b[0m\u001b[32mStart\u001b[0m: Run in container: /bin/sh -c echo post-attach\r\n',
        '\u001b[90m[5036 ms] Stop (33 ms)\u001b[0m: Run in container: /bin/sh -c echo post-attach\r\n',
      ],
    );
  });

  it("F-0415 5.1: raw output keeps its ANSI, and the CLI's own bold heading and output pass through with a carriage return on each line", () => {
    deepStrictEqual(
      recordedRun()
        .filter(event => event.type === 'raw')
        .slice(0, 3)
        .map(event => lifecycleTextOf(event, RUN_START)),
      [
        '\u001b[1mRunning the initializeCommand from devcontainer.json...\u001b[0m\r\n\r\n',
        'init-host\r\n',
        '\r\n',
      ],
    );
  });

  it('F-0415 5.1: raw output gets a carriage return on each lone newline and never a second one', () => {
    deepStrictEqual(
      [
        terminalLines('a\nb\r\n'),
        terminalLines('\r\n\r\n'),
        terminalLines('no newline'),
        terminalLines('x\n\ny\n'),
      ],
      ['a\r\nb\r\n', '\r\n\r\n', 'no newline', 'x\r\n\r\ny\r\n'],
    );
  });

  it("F-0415 AC-11: a failing hook's red text line passes through unchanged, with its line end", () => {
    const failure =
      '\u001b[1m\u001b[31mpostCreateCommand from devcontainer.json failed with exit code 3. Skipping any further user-provided commands.\u001b[39m\u001b[22m\n';
    deepStrictEqual(
      lifecycleTextOf(eventOf({type: 'text', text: failure}), RUN_START),
      failure.replace('\n', '\r\n'),
    );
  });

  it('contracts: an event with no time counts from the start of the run, and a stop with no start time lasts 0 ms', () => {
    deepStrictEqual(
      [
        lifecycleTextOf(eventOf({type: 'start', text: 'x'}), RUN_START),
        lifecycleTextOf(
          eventOf({type: 'stop', text: 'x', timestamp: RUN_START + 7}),
          RUN_START,
        ),
        lifecycleTextOf(
          eventOf({type: 'stop', text: 'x', startTimestamp: RUN_START + 1}),
          RUN_START,
        ),
      ],
      [
        '\u001b[90m[0 ms] \u001b[0m\u001b[32mStart\u001b[0m: x\r\n',
        '\u001b[90m[7 ms] Stop (0 ms)\u001b[0m: x\r\n',
        '\u001b[90m[0 ms] Stop (0 ms)\u001b[0m: x\r\n',
      ],
    );
  });
});
