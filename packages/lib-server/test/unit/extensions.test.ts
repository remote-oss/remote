import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {
  RecordingChannel,
  type ScriptEnding,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ExtensionsOutcome,
  installExtensions,
  RESULT_BEGIN,
  RESULT_END,
} from '../../src/index.ts';
import {
  blockOf,
  fakeHost,
  type FakeHost,
  installedHostPerTest,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {shellChannel} from './shell-channel.ts';

const NEVER_CANCELLED = new AbortController().signal;

/** The extension ids the launcher was asked to install, in call order. */
function installedOn(host: FakeHost): string[] {
  const file = host.environment.EXTENSION_CALLS ?? '';
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
    : [];
}

describe('the installExtensions step of the script', () => {
  const hostOf = installedHostPerTest();

  function parametersWith(extensions: readonly string[]) {
    const parameters = parametersFor();
    parameters.start.extensions = extensions;
    return parameters;
  }

  it('asks the server to install each extension once, in the order given', () => {
    runScript(
      hostOf(),
      single('installExtensions'),
      parametersWith(['one.alpha', 'two.beta']),
    );
    deepStrictEqual(installedOn(hostOf()), ['one.alpha', 'two.beta']);
  });

  it('reports each extension by its position, with the last line the server printed', () => {
    const block = blockOf(
      hostOf(),
      single('installExtensions'),
      parametersWith(['one.alpha', 'two.beta']),
    );
    deepStrictEqual(
      block === 'none' ? block : [block.status, block.serverFacts],
      [
        'Ok',
        {
          'extension.0.status': 'installed',
          'extension.0.message':
            "Extension 'one.alpha' was successfully installed.",
          'extension.1.status': 'installed',
          'extension.1.message':
            "Extension 'two.beta' was successfully installed.",
        },
      ],
    );
  });

  it('goes on after an extension that fails, and the step still ends Ok', () => {
    hostOf().environment.EXTENSION_FAILS = 'one.alpha';
    const block = blockOf(
      hostOf(),
      single('installExtensions'),
      parametersWith(['one.alpha', 'two.beta']),
    );
    deepStrictEqual(
      block === 'none' ? block : [block.status, block.serverFacts],
      [
        'Ok',
        {
          'extension.0.status': 'failed',
          'extension.0.message': "Extension 'one.alpha' not found.",
          'extension.1.status': 'installed',
          'extension.1.message':
            "Extension 'two.beta' was successfully installed.",
        },
      ],
    );
  });

  it('runs under dash, as a Debian host does', () => {
    runScript(
      hostOf(),
      single('installExtensions'),
      parametersWith(['one.alpha', 'two.beta']),
      {shell: '/bin/dash'},
    );
    deepStrictEqual(installedOn(hostOf()), ['one.alpha', 'two.beta']);
  });

  it('hands each id to the server as one word, whatever characters it holds', () => {
    runScript(
      hostOf(),
      single('installExtensions'),
      parametersWith(["it's.odd one;echo"]),
    );
    deepStrictEqual(installedOn(hostOf()), ["it's.odd one;echo"]);
  });

  it('reports nothing and asks for nothing when the list is empty', () => {
    const block = blockOf(
      hostOf(),
      single('installExtensions'),
      parametersWith([]),
    );
    deepStrictEqual(
      [
        block === 'none' ? block : [block.status, block.serverFacts],
        installedOn(hostOf()),
      ],
      [['Ok', {}], []],
    );
  });

  it('fails like a start does when no server is installed', () => {
    const bare = fakeHost();
    const block = blockOf(
      bare,
      single('installExtensions'),
      parametersWith(['one.alpha']),
    );
    deepStrictEqual(
      block === 'none' ? block : block.status,
      'ServerFailedToStart',
    );
  });
});

describe('installExtensions', () => {
  const hostOf = installedHostPerTest();

  /** The outcome and the log lines of an install of `entries` over the real script. */
  async function installed(
    entries: readonly string[],
  ): Promise<[ExtensionsOutcome, string[]]> {
    const sink = new MemorySink();
    const outcome = await installExtensions(
      shellChannel(hostOf()),
      parametersFor(),
      entries,
      createLogger(sink, {minimumLevel: () => 'info'}),
      NEVER_CANCELLED,
    );
    return [outcome, sink.lines.map(line => `${line.level} ${line.message}`)];
  }

  it('installs the kept entries and logs each one', async () => {
    deepStrictEqual(await installed(['one.alpha', 'bad entry']), [
      {
        kind: 'done',
        results: [
          {
            id: 'one.alpha',
            installed: true,
            message: "Extension 'one.alpha' was successfully installed.",
          },
        ],
      },
      [
        'info default extension: one.alpha',
        'warn default extension dropped, not <publisher>.<name>: bad entry',
        'info default extension installed: one.alpha',
      ],
    ]);
  });

  it('logs an extension that failed with the server message, and still reports the others', async () => {
    hostOf().environment.EXTENSION_FAILS = 'one.alpha';
    deepStrictEqual(await installed(['one.alpha', 'two.beta']), [
      {
        kind: 'done',
        results: [
          {
            id: 'one.alpha',
            installed: false,
            message: "Extension 'one.alpha' not found.",
          },
          {
            id: 'two.beta',
            installed: true,
            message: "Extension 'two.beta' was successfully installed.",
          },
        ],
      },
      [
        'info default extension: one.alpha',
        'info default extension: two.beta',
        "warn default extension not installed: one.alpha: Extension 'one.alpha' not found.",
        'info default extension installed: two.beta',
      ],
    ]);
  });

  it('does not contact the host when no entry is an extension identifier', async () => {
    const [outcome] = await installed(['nodot', 'a.b.c']);
    deepStrictEqual(
      [outcome, installedOn(hostOf())],
      [{kind: 'done', results: []}, []],
    );
  });
});

describe('installExtensions when the host does not answer as expected', () => {
  /** The outcome and the "not installed" log lines of an install over a channel that ends as given. */
  async function answered(
    lines: readonly string[],
    ending: ScriptEnding = {kind: 'exit', status: 0},
  ): Promise<[ExtensionsOutcome, string[]]> {
    const sink = new MemorySink();
    const channel = new RecordingChannel({
      identity: 'h',
      platformHint: 'linux',
      scripts: [
        {interpreter: 'posixShell', matches: () => true, lines, ending},
      ],
    });
    const outcome = await installExtensions(
      channel,
      parametersFor(),
      ['one.alpha'],
      createLogger(sink, {minimumLevel: () => 'info'}),
      NEVER_CANCELLED,
    );
    return [
      outcome,
      sink.lines
        .map(line => `${line.level} ${line.message}`)
        .filter(line => line.includes('not installed')),
    ];
  }

  it('is not run, and logs each extension, when the script ends with another status', async () => {
    deepStrictEqual(
      await answered([RESULT_BEGIN, 'status=ServerFailedToStart', RESULT_END]),
      [
        {kind: 'notRun', reason: 'scriptFailed'},
        ['warn default extension not installed: one.alpha: scriptFailed'],
      ],
    );
  });

  it('is not run when the script prints no result block', async () => {
    deepStrictEqual(await answered(['nothing useful']), [
      {kind: 'notRun', reason: 'noResultBlock'},
      ['warn default extension not installed: one.alpha: noResultBlock'],
    ]);
  });

  it('marks an extension the host gave no answer for as not installed', async () => {
    deepStrictEqual(await answered([RESULT_BEGIN, 'status=Ok', RESULT_END]), [
      {
        kind: 'done',
        results: [
          {
            id: 'one.alpha',
            installed: false,
            message: 'the host gave no answer for this extension',
          },
        ],
      },
      [
        'warn default extension not installed: one.alpha: the host gave no answer for this extension',
      ],
    ]);
  });

  it('is not run when the channel fails', async () => {
    const [outcome] = await answered([], {
      kind: 'fail',
      failure: {kind: 'channelClosed', detail: 'ended'},
    });
    deepStrictEqual(outcome, {kind: 'notRun', reason: 'channelFailed'});
  });
});
