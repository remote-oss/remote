import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  type CliEvent,
  daemonRefusalOf,
  parseLogLine,
  readConfigurationResult,
  readRunUserCommandsResult,
  readUpResult,
} from '../../src/cli/cli-lines.ts';

const FIXTURES = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'devcontainers-cli-0.89.0',
);

/** The lines of a recorded file. */
function recorded(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter(line => line !== '');
}

/** The one line of a recorded result file. */
function resultOf(name: string): string {
  return recorded(name)[0] ?? '';
}

describe('the output of the dev container CLI (card containers-04)', () => {
  it('C3: an up success is the container, the user and the workspace folder, and the extra fields are ignored', () => {
    deepStrictEqual(readUpResult(resultOf('up-success.jsonl'), 0), {
      kind: 'up',
      containerId:
        '025da4eefd37f83611b94277ed7215eb31dc77ae6a22822bd58b3000871c6c92',
      remoteUser: 'root',
      remoteWorkspaceFolder: '/workspaces/ws1',
    });
  });

  it('C3: a field of an up success that is missing or not a string is malformed, naming the field', () => {
    deepStrictEqual(
      [
        '{"outcome":"success","containerId":"c","remoteWorkspaceFolder":"/w"}',
        '{"outcome":"success","remoteUser":"r","remoteWorkspaceFolder":"/w"}',
        '{"outcome":"success","containerId":"c","remoteUser":"r","remoteWorkspaceFolder":5}',
      ].map(line => readUpResult(line, 0)),
      [
        {kind: 'malformedResult', field: 'remoteUser'},
        {kind: 'malformedResult', field: 'containerId'},
        {kind: 'malformedResult', field: 'remoteWorkspaceFolder'},
      ],
    );
  });

  it('C3: the failure of onCreateCommand is a lifecycle failure with the hook and the container', () => {
    deepStrictEqual(readUpResult(resultOf('up-error-oncreate.jsonl'), 1), {
      kind: 'lifecycleFailed',
      hook: 'onCreateCommand',
      part: undefined,
      message: 'Command failed: /bin/sh -c exit 4',
      containerId:
        'fcf59aa9b58801c6a6eeb0b70b92c6f887a54a64b0117f6666e059afa4616a15',
    });
  });

  it('C3: a part of an object-form hook that failed is named', () => {
    deepStrictEqual(
      readUpResult(
        '{"outcome":"error","message":"m","description":"build of postCreateCommand from devcontainer.json failed."}',
        1,
      ),
      {
        kind: 'lifecycleFailed',
        hook: 'postCreateCommand',
        part: 'build',
        message: 'm',
        containerId: undefined,
      },
    );
  });

  it('C3: the failure of initializeCommand is a lifecycle failure', () => {
    deepStrictEqual(
      readUpResult(
        '{"outcome":"error","message":"m","description":"The initializeCommand in the devcontainer.json failed."}',
        1,
      ),
      {
        kind: 'lifecycleFailed',
        hook: 'initializeCommand',
        part: undefined,
        message: 'm',
        containerId: undefined,
      },
    );
  });

  it('C3: a failed Dockerfile build, a failed pull and any other error are told apart', () => {
    deepStrictEqual(
      [
        readUpResult(resultOf('up-error-build.jsonl'), 1).kind,
        readUpResult(resultOf('up-error-pull.jsonl'), 1).kind,
        readUpResult(
          '{"outcome":"error","message":"something else","description":"An error occurred setting up the container."}',
          1,
        ).kind,
        readUpResult('{"outcome":"error"}', 1).kind,
      ],
      ['buildFailed', 'pullFailed', 'setupFailed', 'setupFailed'],
    );
  });

  it('F-0414 7.E10: an error result that names a disallowed Feature is a disallowed Feature, with its address and whether a container was stopped', () => {
    deepStrictEqual(
      [
        '{"outcome":"error","message":"Cannot use the x Feature","description":"d","disallowedFeatureId":"ghcr.io/o/f:1","didStopContainer":false,"learnMoreUrl":"https://example.org/f"}',
        '{"outcome":"error","message":"m","description":"d","disallowedFeatureId":"ghcr.io/o/f:1","didStopContainer":true}',
      ].map(line => readUpResult(line, 1)),
      [
        {
          kind: 'disallowedFeature',
          message: 'Cannot use the x Feature',
          featureId: 'ghcr.io/o/f:1',
          stoppedContainer: false,
          learnMoreUrl: 'https://example.org/f',
        },
        {
          kind: 'disallowedFeature',
          message: 'm',
          featureId: 'ghcr.io/o/f:1',
          stoppedContainer: true,
          learnMoreUrl: undefined,
        },
      ],
    );
  });

  it('C3: a docker build line without buildx is a build failure too', () => {
    deepStrictEqual(
      readUpResult(
        '{"outcome":"error","message":"Command failed: docker build -t x .","description":"d"}',
        1,
      ).kind,
      'buildFailed',
    );
  });

  it('C3: a process that ended without a result line, and a line that is not an object or not JSON', () => {
    deepStrictEqual(
      [
        readUpResult(undefined, 137),
        readUpResult('[1]', 0),
        readUpResult('not json', 0),
      ],
      [
        {kind: 'noResult', status: 137},
        {kind: 'malformedResult', field: 'result'},
        {kind: 'malformedResult', field: 'result'},
      ],
    );
  });

  it('C3: run-user-commands succeeds with done, and any other result is malformed', () => {
    deepStrictEqual(
      [
        readRunUserCommandsResult(
          resultOf('run-user-commands-success.jsonl'),
          0,
        ),
        readRunUserCommandsResult(
          '{"outcome":"success","result":"skipNonBlocking"}',
          0,
        ),
      ],
      [{kind: 'done'}, {kind: 'malformedResult', field: 'result'}],
    );
  });

  it('C3: run-user-commands errors follow the same classification, and no line is no result', () => {
    deepStrictEqual(
      [
        readRunUserCommandsResult(resultOf('up-error-oncreate.jsonl'), 1).kind,
        readRunUserCommandsResult(undefined, 1),
      ],
      ['lifecycleFailed', {kind: 'noResult', status: 1}],
    );
  });

  it('C3: read-configuration gives the configuration and the workspace folder, with no consistency on Linux', () => {
    const configured = readConfigurationResult(
      resultOf('read-configuration.jsonl'),
      undefined,
    );
    deepStrictEqual(
      configured.kind === 'configuration'
        ? [
            configured.workspaceFolder,
            configured.workspaceMount,
            configured.configuration.name,
            configured.mergedConfiguration?.image,
          ]
        : configured,
      [
        '/workspaces/ws1',
        'type=bind,source=/work/ws1,target=/workspaces/ws1',
        'c3-probe',
        'alpine:3.22',
      ],
    );
  });

  it('C3: read-configuration without a workspace or a configuration is malformed, naming it', () => {
    deepStrictEqual(
      [
        readConfigurationResult('{"configuration":{}}', undefined),
        readConfigurationResult(
          '{"configuration":{},"workspace":{}}',
          undefined,
        ),
        readConfigurationResult(
          '{"workspace":{"workspaceFolder":"/w"}}',
          undefined,
        ),
      ],
      [
        {kind: 'malformedResult', field: 'workspace.workspaceFolder'},
        {kind: 'malformedResult', field: 'workspace.workspaceFolder'},
        {kind: 'malformedResult', field: 'configuration'},
      ],
    );
  });

  it('C3: read-configuration without optional fields leaves them undefined', () => {
    deepStrictEqual(
      readConfigurationResult(
        '{"configuration":{},"workspace":{"workspaceFolder":"/w"}}',
        undefined,
      ),
      {
        kind: 'configuration',
        configuration: {},
        workspaceFolder: '/w',
        workspaceMount: undefined,
        mergedConfiguration: undefined,
      },
    );
  });

  it('C3: read-configuration that ends with no line is a configuration failure with the last error, or nothing', () => {
    deepStrictEqual(
      [
        readConfigurationResult(
          undefined,
          'Error: Dev container config (/work/ws7/nope.json) not found.',
        ),
        readConfigurationResult(undefined, undefined),
      ],
      [
        {
          kind: 'configurationFailed',
          message:
            'Error: Dev container config (/work/ws7/nope.json) not found.',
        },
        {kind: 'configurationFailed', message: ''},
      ],
    );
  });

  it('C3: each recorded type of stderr line is its event', () => {
    deepStrictEqual(
      recorded('stderr-events.jsonl')
        .slice(0, 6)
        .map(parseLogLine)
        .map(event =>
          event.kind === 'log'
            ? [event.kind, event.level, event.channel]
            : [event.kind, event.name, event.status],
        ),
      [
        ['log', 3, undefined],
        ['log', 2, undefined],
        ['log', 2, undefined],
        ['log', 3, 'postCreate'],
        ['progress', 'Running postCreateCommand...', 'running'],
        ['progress', 'Running postCreateCommand...', 'succeeded'],
      ],
    );
  });

  it('C3: a progress line with its detail has the detail, and one without has none', () => {
    const [running, succeeded] = recorded('stderr-events.jsonl')
      .slice(4, 6)
      .map(parseLogLine) as [CliEvent, CliEvent];
    deepStrictEqual(
      [
        running.kind === 'progress' ? running.detail : undefined,
        succeeded.kind === 'progress' ? succeeded.detail : 'not progress',
      ],
      ['echo created > /tmp/c3-created', undefined],
    );
  });

  it('F-0415 5.1: an event keeps its type and its times', () => {
    deepStrictEqual(
      [
        parseLogLine(
          '{"type":"stop","level":2,"timestamp":120,"text":"Run: x","startTimestamp":100,"channel":"postCreate"}',
        ),
        parseLogLine(
          '{"type":"start","level":2,"timestamp":100,"text":"Run: x","channel":"postCreate"}',
        ),
        parseLogLine('{"type":"raw","text":"a\\n","timestamp":"soon"}'),
        parseLogLine('{"type":"other","text":"b"}'),
      ].map(event =>
        event.kind === 'log'
          ? [event.type, event.timestamp, event.startTimestamp]
          : undefined,
      ),
      [
        ['stop', 120, 100],
        ['start', 100, undefined],
        ['raw', undefined, undefined],
        ['text', undefined, undefined],
      ],
    );
  });

  it('C3: text with ANSI codes is kept unchanged', () => {
    const event = parseLogLine(recorded('stderr-events.jsonl')[3] ?? '');
    deepStrictEqual(
      event.kind === 'log' ? event.text : undefined,
      '\u001b[1mRunning the postCreateCommand from devcontainer.json...\u001b[0m\r\n\r\n',
    );
  });

  it('C3: a Node warning line is a log at level 3, whole', () => {
    const line = recorded('stderr-events.jsonl')[6] ?? '';
    deepStrictEqual(parseLogLine(line), {
      kind: 'log',
      level: 3,
      text: line,
      channel: undefined,
      type: 'text',
      timestamp: undefined,
      startTimestamp: undefined,
    });
  });

  it('ADR-0010: stderr lines that only look like a result or an event are plain log lines, whole', () => {
    const noise = [
      'npm WARN {"outcome":"success","containerId":"x"}',
      '  {"outcome":"error"}',
      'ERROR: Your fridge is not running',
      'see remote-oss-server-result-begin for details',
      'status=Ok',
      'motd: Permission denied (publickey) is a test',
      'ERROR: Your fridge is not running\r',
    ];
    deepStrictEqual(
      noise.map(parseLogLine),
      noise.map(line => ({
        kind: 'log',
        level: 3,
        text: line,
        channel: undefined,
        type: 'text',
        timestamp: undefined,
        startTimestamp: undefined,
      })),
    );
  });

  it('C3: a JSON line that is not an object, and an object without a level or a text, never throw', () => {
    deepStrictEqual(
      [parseLogLine('5'), parseLogLine('{"type":"text"}')],
      [
        {
          kind: 'log',
          level: 3,
          text: '5',
          channel: undefined,
          type: 'text',
          timestamp: undefined,
          startTimestamp: undefined,
        },
        {
          kind: 'log',
          level: 3,
          text: '{"type":"text"}',
          channel: undefined,
          type: 'text',
          timestamp: undefined,
          startTimestamp: undefined,
        },
      ],
    );
  });

  it('C3: a progress event without a name or a status has empty ones', () => {
    deepStrictEqual(parseLogLine('{"type":"progress"}'), {
      kind: 'progress',
      name: '',
      status: '',
      detail: undefined,
    });
  });

  it('C3: a read-configuration line that is not a JSON object is malformed', () => {
    deepStrictEqual(readConfigurationResult('not json', undefined), {
      kind: 'malformedResult',
      field: 'result',
    });
  });
});

describe('the daemon refusal (card containers-11)', () => {
  const MOUNT_MISSING =
    'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /nonexistent-c11-src';
  const MOUNT_EMPTY =
    'docker: Error response from daemon: invalid mount config for type "bind": field Source must not be empty';
  const MOUNT_RESTART =
    'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /tmp/c11src';
  const PORT_TAKEN =
    'docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint laughing_pare (da74): Bind for 0.0.0.0:47321 failed: port is already allocated';

  it('F-0410 7.E1, AC-11: a refused bind mount, with or without the docker prefix, is invalidMount', () => {
    deepStrictEqual(
      [MOUNT_MISSING, MOUNT_EMPTY, MOUNT_RESTART].map(daemonRefusalOf),
      ['invalidMount', 'invalidMount', 'invalidMount'],
    );
  });

  it('F-0410 7.E2, AC-12: a port that is already allocated is portAllocated, with or without the docker prefix', () => {
    deepStrictEqual(
      [PORT_TAKEN, PORT_TAKEN.slice('docker: '.length)].map(daemonRefusalOf),
      ['portAllocated', 'portAllocated'],
    );
  });

  it('ADR-0010: a line with text before the daemon words, another daemon error, text after the port words, or nothing is no refusal', () => {
    deepStrictEqual(
      [
        `[hook] ${MOUNT_MISSING}`,
        'Error response from daemon: No such container: x',
        `${PORT_TAKEN} (retrying)`,
        '',
      ].map(daemonRefusalOf),
      [undefined, undefined, undefined, undefined],
    );
  });
});
