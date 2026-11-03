import {deepStrictEqual} from 'node:assert';
import {classify} from '../../src/diagnostics/classify.ts';
import {
  environmentHints,
  settingValueText,
  STATUS_NUMBERS,
  statusNumberOf,
} from '../../src/diagnostics/session-hints.ts';

const SNAPSHOT = {
  settings: [
    {
      name: 'useLocalServer',
      value: true,
      description: 'Uses the local server.',
    },
    {name: 'path', value: '', description: 'The ssh program.'},
    {name: 'httpProxy', value: undefined, description: 'A proxy.'},
    {name: 'defaultExtensions', value: ['a.b', 'c.d']},
    {name: 'bindHost', value: {x: 1}, description: 'The host.'},
    {name: 'maxConnections', value: 2},
  ],
  editorVersion: '1.140.0',
  extensionVersion: '0.1.0',
  platform: 'linux',
  architecture: 'arm64',
};

describe('the environment hints of a session record (card connect-135, F-2605 BR-9)', () => {
  it('F-2605.AC-17: a hint for each setting in the given order, then the editor, the extension and the client', () => {
    deepStrictEqual(
      environmentHints(SNAPSHOT).map(hint => hint.message),
      [
        "Extension setting 'useLocalServer' is set to value 'true'",
        "Extension setting 'path' is set to value ''",
        "Extension setting 'httpProxy' is set to value 'undefined'",
        'Extension setting \'defaultExtensions\' is set to value \'["a.b","c.d"]\'',
        "Extension setting 'bindHost' is set to value '{\"x\":1}'",
        "Extension setting 'maxConnections' is set to value '2'",
        'VS Code version: 1.140.0',
        'Remote-SSH version: remote-ssh@0.1.0',
        'linux arm64',
      ],
    );
  });

  it('F-2605.AC-17: a setting with a description has it as details, one without has none, and the last three have none', () => {
    deepStrictEqual(
      environmentHints(SNAPSHOT).map(hint => hint.details),
      [
        'Uses the local server.',
        'The ssh program.',
        'A proxy.',
        undefined,
        'The host.',
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('F-2605.AC-17: every hint is of the environment kind, and a hint without details has no details key', () => {
    deepStrictEqual(
      environmentHints(SNAPSHOT).map(hint => [hint.kind, 'details' in hint]),
      [
        ['environment', true],
        ['environment', true],
        ['environment', true],
        ['environment', false],
        ['environment', true],
        ['environment', false],
        ['environment', false],
        ['environment', false],
        ['environment', false],
      ],
    );
  });

  it('F-2605 BR-9: a string is written as it is, anything else as JSON text, and nothing as undefined', () => {
    deepStrictEqual(
      ['text', '', true, 2, [], {}, null, undefined].map(settingValueText),
      ['text', '', 'true', '2', '[]', '{}', 'null', 'undefined'],
    );
  });
});

describe('the numbers of the error statuses (card connect-135)', () => {
  it('pins the whole table: no number is ever changed or used twice', () => {
    deepStrictEqual(STATUS_NUMBERS, {
      PermissionDenied: 1,
      InvalidHostName: 2,
      OfflineError: 3,
      MitmPortForwardingDisabled: 4,
      AllowTcpForwardingDisabled: 5,
      SendDisconnectBrokenPipe: 6,
      ServerDownloadFailed: 7,
      NoDownloaderAvailable: 8,
      InvalidProxyUrl: 9,
    });
  });

  it('gives each status of the table its number, and a status it does not hold none', () => {
    deepStrictEqual(
      ['OfflineError', 'NoDownloaderAvailable', 'Nothing', 'toString'].map(
        statusNumberOf,
      ),
      [3, 8, undefined, undefined],
    );
  });

  it('uses each number once', () => {
    const numbers = Object.values(STATUS_NUMBERS);
    deepStrictEqual(new Set(numbers).size, numbers.length);
  });

  it('numbers the status of every hint the classifier gives', () => {
    const lines = [
      'user@h: Permission denied (publickey).',
      'hostname contains invalid characters',
      'ssh: connect to host h port 22: Network is unreachable',
      'Port forwarding is disabled to avoid man-in-the-middle attacks.',
      'channel 2: open failed: administratively prohibited: open failed',
      'Connection to h port 22: send disconnect: Broken pipe',
    ];
    deepStrictEqual(
      lines.map(line =>
        classify([line], 255, 'connection', 'terminal').hints.map(hint =>
          statusNumberOf(hint.status),
        ),
      ),
      [[1], [2], [3], [4], [5], [6]],
    );
  });
});
