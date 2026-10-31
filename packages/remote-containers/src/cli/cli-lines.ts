/**
 * @fileoverview The output of the dev container CLI as typed values: the one JSON result line on stdout (read
 * differently for each subcommand), and the events of stderr, one JSON object a line. Nothing here throws.
 */

/** Why the Docker daemon refused to create or start the container, by its own words. */
export type DaemonRefusal = 'invalidMount' | 'portAllocated';

const INVALID_MOUNT =
  /^(?:docker: )?Error response from daemon: invalid mount config for type "/u;
const PORT_ALLOCATED =
  /^(?:docker: )?Error response from daemon: .*: Bind for \S+ failed: port is already allocated$/u;

/** The refusal one line of the Docker client says, or undefined; the line has no colour codes and no CR. */
export function daemonRefusalOf(line: string): DaemonRefusal | undefined {
  if (INVALID_MOUNT.test(line)) {
    return 'invalidMount';
  }
  return PORT_ALLOCATED.test(line) ? 'portAllocated' : undefined;
}

/** Why a subcommand did not give its result. */
export type CliFailure =
  | {
      kind: 'lifecycleFailed';
      hook: string;
      part: string | undefined;
      message: string;
      containerId: string | undefined;
    }
  | {kind: 'configurationFailed'; message: string}
  | {
      kind: 'disallowedFeature';
      message: string;
      /** The id of the Feature as the configuration wrote it. */
      featureId: string;
      /** Whether the CLI's check stopped a running container of the same configuration. */
      stoppedContainer: boolean;
      /** Where the control manifest explains the Feature; absent when its entry gives none. */
      learnMoreUrl: string | undefined;
    }
  | {kind: 'buildFailed'; message: string}
  | {kind: 'pullFailed'; message: string}
  | {
      kind: 'setupFailed';
      message: string;
      description: string;
      containerId: string | undefined;
      /** Why the daemon refused, when the CLI relayed its words; absent otherwise. */
      refusal?: DaemonRefusal;
    }
  | {kind: 'noResult'; status: number | null}
  | {kind: 'malformedResult'; field: string}
  | {kind: 'spawnFailed'; message: string}
  | {kind: 'cancelled'};

/** What `up` gives. */
export type UpResult =
  | {
      kind: 'up';
      containerId: string;
      remoteUser: string;
      remoteWorkspaceFolder: string;
    }
  | CliFailure;

/** What `run-user-commands` gives. */
export type RunUserCommandsResult = {kind: 'done'} | CliFailure;

/** What `templates apply` gives. */
export type ApplyTemplateResult =
  {kind: 'applied'; files: string[]} | CliFailure;

/** What `templates metadata` gives. */
export type TemplateMetadataResult =
  {kind: 'metadata'; metadata: Readonly<Record<string, unknown>>} | CliFailure;

/** What `read-configuration` gives. */
export interface ConfigurationResult {
  kind: 'configuration';
  /** The substituted devcontainer.json, as the CLI gives it. */
  configuration: Record<string, unknown>;
  workspaceFolder: string;
  workspaceMount: string | undefined;
  mergedConfiguration: Record<string, unknown> | undefined;
}

/** One line of the CLI's stderr. */
export type CliEvent =
  | {
      kind: 'progress';
      name: string;
      status: string;
      detail: string | undefined;
    }
  | {
      kind: 'log';
      level: number;
      text: string;
      channel: string | undefined;
      /** The CLI's event type: `raw` output, a `start` or `stop` of a step, or a `text` line; `text` for anything else. */
      type: 'raw' | 'start' | 'stop' | 'text';
      /** The CLI's own time of the event, in epoch milliseconds; none for a line that isn't JSON. */
      timestamp: number | undefined;
      /** For a `stop`: when its step started, in epoch milliseconds. */
      startTimestamp: number | undefined;
    };

/** The control sequences of a terminal line: its colours and its cursor moves. */
const CONTROL_SEQUENCES = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`,
  'gu',
);

/** The text without its control sequences. */
export function withoutControlSequences(text: string): string {
  return text.replace(CONTROL_SEQUENCES, '');
}

/** The level of a line that is not an event: Node's own warnings and stack lines. */
const PLAIN_LINE_LEVEL = 3;

/** A hook of a lifecycle command failing: the CLI's text `<part> of <hook> from <source> failed.` */
const HOOK_FAILED = /^(?:(\S+) of )?(\S+) from (.+) failed\.$/;

/** The text of `initializeCommand` failing. */
const INITIALIZE_FAILED = /^The (\S+) in the devcontainer\.json failed\.$/;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** The event type of a log line: the three the terminal renders, else `text`. */
function eventTypeOf(value: unknown): 'raw' | 'start' | 'stop' | 'text' {
  return value === 'raw' || value === 'start' || value === 'stop'
    ? value
    : 'text';
}

/** A line of stderr as its event, with what the bridge needs to buffer output: whether it is raw, and its channel. */
export interface StderrLine {
  event: CliEvent;
  /** Whether the line is a `raw` event: output of a lifecycle command, chunk by chunk. */
  isRaw: boolean;
  channel: string | undefined;
}

/** The event a line of stderr is, and the facts of the line that tell how output is held. */
export function readStderrLine(line: string): StderrLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {event: plain(line), isRaw: false, channel: undefined};
  }
  if (!isFields(parsed)) {
    return {event: plain(line), isRaw: false, channel: undefined};
  }
  const channel = textOf(parsed.channel);
  if (parsed.type === 'progress') {
    return {
      event: {
        kind: 'progress',
        name: textOf(parsed.name) ?? '',
        status: textOf(parsed.status) ?? '',
        detail: textOf(parsed.stepDetail),
      },
      isRaw: false,
      channel,
    };
  }
  return {
    event: {
      kind: 'log',
      level: typeof parsed.level === 'number' ? parsed.level : PLAIN_LINE_LEVEL,
      text: textOf(parsed.text) ?? line,
      channel,
      type: eventTypeOf(parsed.type),
      timestamp: numberOf(parsed.timestamp),
      startTimestamp: numberOf(parsed.startTimestamp),
    },
    isRaw: parsed.type === 'raw',
    channel,
  };
}

/** The event a line of stderr is. */
export function parseLogLine(line: string): CliEvent {
  return readStderrLine(line).event;
}

function plain(line: string): CliEvent {
  return {
    kind: 'log',
    level: PLAIN_LINE_LEVEL,
    text: line,
    channel: undefined,
    type: 'text',
    timestamp: undefined,
    startTimestamp: undefined,
  };
}

/** The failure an `error` result is, by the CLI's own words. */
function errorOf(fields: Fields): CliFailure {
  const message = textOf(fields.message) ?? '';
  const description = textOf(fields.description) ?? '';
  const containerId = textOf(fields.containerId);
  const disallowedFeatureId = textOf(fields.disallowedFeatureId);
  if (disallowedFeatureId !== undefined) {
    return {
      kind: 'disallowedFeature',
      message,
      featureId: disallowedFeatureId,
      stoppedContainer: fields.didStopContainer === true,
      learnMoreUrl: textOf(fields.learnMoreUrl),
    };
  }
  const hook = HOOK_FAILED.exec(description);
  if (hook?.[2] !== undefined) {
    return {
      kind: 'lifecycleFailed',
      hook: hook[2],
      part: hook[1],
      message,
      containerId,
    };
  }
  const initialize = INITIALIZE_FAILED.exec(description);
  if (initialize?.[1] !== undefined) {
    return {
      kind: 'lifecycleFailed',
      hook: initialize[1],
      part: undefined,
      message,
      containerId,
    };
  }
  if (
    message.startsWith('Command failed: docker buildx build') ||
    message.startsWith('Command failed: docker build ')
  ) {
    return {kind: 'buildFailed', message};
  }
  if (message.startsWith('Command failed: docker pull ')) {
    return {kind: 'pullFailed', message};
  }
  return {kind: 'setupFailed', message, description, containerId};
}

/** The fields of a result line, or the failure that it has none. */
type Parsed = {fields: Fields} | {failure: CliFailure};

function parsedResult(
  result: string | undefined,
  status: number | null,
): Parsed {
  if (result === undefined) {
    return {failure: {kind: 'noResult', status}};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    return isFields(parsed)
      ? {fields: parsed}
      : {failure: {kind: 'malformedResult', field: 'result'}};
  } catch {
    return {failure: {kind: 'malformedResult', field: 'result'}};
  }
}

/** What `up` gave, from its result line (undefined when there was none) and the process's status. */
export function readUpResult(
  result: string | undefined,
  status: number | null,
): UpResult {
  const parsed = parsedResult(result, status);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  const {fields} = parsed;
  if (fields.outcome === 'error') {
    return errorOf(fields);
  }
  const containerId = textOf(fields.containerId);
  const remoteUser = textOf(fields.remoteUser);
  const remoteWorkspaceFolder = textOf(fields.remoteWorkspaceFolder);
  if (containerId === undefined) {
    return {kind: 'malformedResult', field: 'containerId'};
  }
  if (remoteUser === undefined) {
    return {kind: 'malformedResult', field: 'remoteUser'};
  }
  if (remoteWorkspaceFolder === undefined) {
    return {kind: 'malformedResult', field: 'remoteWorkspaceFolder'};
  }
  return {kind: 'up', containerId, remoteUser, remoteWorkspaceFolder};
}

/** What `run-user-commands` gave. */
export function readRunUserCommandsResult(
  result: string | undefined,
  status: number | null,
): RunUserCommandsResult {
  const parsed = parsedResult(result, status);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  const {fields} = parsed;
  if (fields.outcome === 'error') {
    return errorOf(fields);
  }
  return fields.result === 'done'
    ? {kind: 'done'}
    : {kind: 'malformedResult', field: 'result'};
}

/**
 * What `read-configuration` gave. It has no `outcome`; on an error it writes no result line, and `lastError` is the
 * first line of its last error event, already scrubbed.
 */
export function readConfigurationResult(
  result: string | undefined,
  lastError: string | undefined,
): ConfigurationResult | CliFailure {
  if (result === undefined) {
    return {kind: 'configurationFailed', message: lastError ?? ''};
  }
  const parsed = parsedResult(result, null);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  const {configuration, workspace, mergedConfiguration} = parsed.fields;
  if (!isFields(configuration)) {
    return {kind: 'malformedResult', field: 'configuration'};
  }
  const workspaceFolder = isFields(workspace)
    ? textOf(workspace.workspaceFolder)
    : undefined;
  if (!isFields(workspace) || workspaceFolder === undefined) {
    return {kind: 'malformedResult', field: 'workspace.workspaceFolder'};
  }
  return {
    kind: 'configuration',
    configuration,
    workspaceFolder,
    workspaceMount: textOf(workspace.workspaceMount),
    mergedConfiguration: isFields(mergedConfiguration)
      ? mergedConfiguration
      : undefined,
  };
}

/**
 * The result line of a `templates` subcommand as an object: they have no `outcome`, so a failure is a non-zero status
 * or a line that is no object. Stderr is never read for meaning.
 */
function templateFields(
  result: string | undefined,
  status: number | null,
): Parsed {
  return status === 0
    ? parsedResult(result, status)
    : {failure: {kind: 'noResult', status}};
}

/** What `templates apply` gave: the files it wrote, from its one JSON line. */
export function readApplyTemplateResult(
  result: string | undefined,
  status: number | null,
): ApplyTemplateResult {
  const parsed = templateFields(result, status);
  if ('failure' in parsed) {
    return parsed.failure;
  }
  const {files} = parsed.fields;
  return Array.isArray(files) &&
    files.every((file): file is string => typeof file === 'string')
    ? {kind: 'applied', files}
    : {kind: 'malformedResult', field: 'files'};
}

/** What `templates metadata` gave: the template's metadata, from its one JSON line. */
export function readTemplateMetadataResult(
  result: string | undefined,
  status: number | null,
): TemplateMetadataResult {
  const parsed = templateFields(result, status);
  return 'failure' in parsed
    ? parsed.failure
    : {kind: 'metadata', metadata: parsed.fields};
}
