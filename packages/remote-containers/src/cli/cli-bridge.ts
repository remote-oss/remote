/**
 * @fileoverview What the other components call to drive the dev container CLI: for each subcommand, the target read,
 * the override pre-pass run, the CLI run through the host, and the result and the events scrubbed of the user's
 * secrets before they leave. Nothing here shows anything or decides anything about reuse.
 */

import type {Logger} from 'lib-log';
import {
  applyTemplateArguments,
  type AttachedCliTarget,
  type CliTarget,
  outdatedArguments,
  readConfigurationArguments,
  runUserCommandsArguments,
  type RunUserCommandsOptions,
  setUpArguments,
  type TemplateRequest,
  templateMetadataArguments,
  upArguments,
  type UpOptions,
} from './cli-arguments.ts';
import type {CliHost, StdinOf} from './cli-host.ts';
import {
  type ApplyTemplateResult,
  type CliEvent,
  type CliFailure,
  type ConfigurationResult,
  daemonRefusalOf,
  type DaemonRefusal,
  type OutdatedResult,
  readStderrLine,
  readApplyTemplateResult,
  readConfigurationResult,
  readOutdatedResult,
  readRunUserCommandsResult,
  readSetUpResult,
  readTemplateMetadataResult,
  readUpResult,
  type RunUserCommandsResult,
  type SetUpResult,
  type TemplateMetadataResult,
  type UpResult,
  withoutControlSequences,
} from './cli-lines.ts';
import {linkedAbort} from '../linked-abort.ts';
import {rawHoldOf} from './cli-raw-lines.ts';
import {referencedSecrets, scrubbed, type Secret} from './cli-secrets.ts';
import {dropsImage, overrideText} from './override-pre-pass.ts';
import type {OverrideStore} from './override-files.ts';

/** How long the CLI may keep running after its result line before it is ended. */
const GUARD_MILLISECONDS = 30_000;

/**
 * How long a lifecycle command's unfinished line waits for more of itself: a prompt that waits for its answer prints
 * nothing more, and shows once this has passed; a value the CLI writes as one burst is joined well within it.
 */
const TAIL_IDLE_MILLISECONDS = 50;

/** What the components call. */
export interface CliBridge {
  up(
    target: CliTarget,
    options: UpOptions,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<UpResult>;
  runUserCommands(
    target: CliTarget,
    containerId: string,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
    options?: RunUserCommandsOptions,
  ): Promise<RunUserCommandsResult>;
  readConfiguration(
    target: CliTarget,
    containerId: string | undefined,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<ConfigurationResult | CliFailure>;
  /** Sets up the running container `target` names; no override file is made and no folder is read. */
  setUp(
    target: AttachedCliTarget,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<SetUpResult | CliFailure>;
  /** Applies a template into the request's folder; stderr lines go to `onLine` and are never read for meaning. */
  applyTemplate(
    request: TemplateRequest,
    onLine: (line: string) => void,
    cancellation: AbortSignal,
  ): Promise<ApplyTemplateResult>;
  /** Which Features of the target's configuration are behind; its stderr is dropped. */
  outdated(
    target: CliTarget,
    cancellation: AbortSignal,
  ): Promise<OutdatedResult>;
  /** Reads a template's metadata; its stderr is dropped. */
  templateMetadata(
    templateId: string,
    cancellation: AbortSignal,
  ): Promise<TemplateMetadataResult>;
}

/** The last refusal the Docker client's words in `text` say, one line at a time with control sequences and the CR gone. */
function refusalIn(text: string): DaemonRefusal | undefined {
  return text
    .split('\n')
    .map(line =>
      daemonRefusalOf(withoutControlSequences(line).replace(/\r$/u, '')),
    )
    .findLast(found => found !== undefined);
}

/** A setup failure with the daemon's refusal on it, when there was one; any other result as it is. */
function withRefusal<Result extends {kind: string}>(
  result: Result,
  refusal: DaemonRefusal | undefined,
): Result {
  return result.kind === 'setupFailed' && refusal !== undefined
    ? {...result, refusal}
    : result;
}

/** The client's files the bridge reads. */
export interface BridgeFiles {
  readText(file: string): Promise<string>;
}

/** The event with the secrets in its texts replaced by their references. */
function scrubbedEvent(event: CliEvent, secrets: readonly Secret[]): CliEvent {
  return event.kind === 'log'
    ? {...event, text: scrubbed(event.text, secrets)}
    : {
        ...event,
        name: scrubbed(event.name, secrets),
        detail:
          event.detail === undefined
            ? undefined
            : scrubbed(event.detail, secrets),
      };
}

/** The value with the secrets in the texts of a failure (its messages and descriptions) replaced. */
function scrubbedResult<Result extends {kind: string}>(
  result: Result,
  secrets: readonly Secret[],
): Result {
  const fields: Record<string, unknown> = {...result};
  for (const name of ['message', 'description']) {
    const text = fields[name];
    if (typeof text === 'string') {
      fields[name] = scrubbed(text, secrets);
    }
  }
  return fields as Result;
}

/** The first line of a text. */
function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end < 0 ? text : text.slice(0, end);
}

/**
 * The CLI bridge over its host, the client's files, the override store and the editor's environment; `rewrite` gives the
 * override text of a configuration, or none to let the CLI read the file itself.
 */
export function cliBridgeOf(
  host: CliHost,
  files: BridgeFiles,
  overrides: OverrideStore,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
  logger: Logger,
  rewrite: (configText: string) => string | undefined = configText =>
    overrideText(configText, editorEnvironment),
): CliBridge {
  /** One run of the CLI with `cliArguments`: events to `onEvent`, the secrets scrubbed, the result read by `read`. */
  async function runCli<Result extends {kind: string}>(
    cliArguments: string[],
    environment: Readonly<Record<string, string>> | undefined,
    secrets: readonly Secret[],
    read: (
      result: string | undefined,
      status: number | null,
      lastError: string | undefined,
    ) => Result,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<Result | CliFailure> {
    const own = new AbortController();
    function forward(): void {
      own.abort();
    }
    if (cancellation.aborted) {
      forward();
    }
    cancellation.addEventListener('abort', forward, {once: true});
    let lastError: string | undefined;
    let refusal: DaemonRefusal | undefined;
    const rawHold = rawHoldOf();
    function deliver(unscrubbed: CliEvent): void {
      const event = scrubbedEvent(unscrubbed, secrets);
      if (event.kind === 'log') {
        lastError = firstLine(event.text);
        // Only the client's own lines count: a lifecycle command's output has a channel.
        refusal =
          (event.channel === undefined ? refusalIn(event.text) : undefined) ??
          refusal;
      }
      onEvent(event);
    }
    let guard: NodeJS.Timeout | undefined;
    let idle: NodeJS.Timeout | undefined;
    try {
      const finished = await host.run(
        cliArguments,
        ({stream, line}) => {
          if (stream === 'stdout') {
            guard ??= setTimeout(() => {
              logger.warn(
                'the dev container CLI kept running after its result; ended',
              );
              own.abort();
            }, GUARD_MILLISECONDS);
            return;
          }
          const read = readStderrLine(line);
          if (read.isRaw && read.event.kind === 'log') {
            rawHold.push(read.event).forEach(deliver);
            clearTimeout(idle);
            idle = setTimeout(() => {
              rawHold.releaseAll().forEach(deliver);
            }, TAIL_IDLE_MILLISECONDS);
            return;
          }
          rawHold.release(read.channel).forEach(deliver);
          deliver(read.event);
        },
        own.signal,
        onStdin,
        environment,
      );
      rawHold.releaseAll().forEach(deliver);
      if (finished.kind === 'spawnFailed') {
        return {kind: 'spawnFailed', message: finished.message};
      }
      if (cancellation.aborted) {
        return {kind: 'cancelled'};
      }
      return scrubbedResult(
        withRefusal(read(finished.result, finished.status, lastError), refusal),
        secrets,
      );
    } finally {
      clearTimeout(guard);
      clearTimeout(idle);
      cancellation.removeEventListener('abort', forward);
    }
  }

  /** One run: prepares the target, runs the CLI, reads what it wrote, and removes the override file. */
  async function drive<Result extends {kind: string}>(
    target: CliTarget,
    argumentsOf: (prepared: CliTarget) => string[],
    read: (
      result: string | undefined,
      status: number | null,
      lastError: string | undefined,
    ) => Result,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
  ): Promise<Result | CliFailure> {
    const configText = await files.readText(target.configFile).catch(() => '');
    const secrets = referencedSecrets(configText, editorEnvironment);
    const rewritten = rewrite(configText);
    if (dropsImage(configText)) {
      logger.info(
        "the configuration's image is ignored, because it also builds from a Dockerfile (F-0412 Q-1)",
      );
    }
    const overrideFile =
      rewritten === undefined ? undefined : await overrides.write(rewritten);
    try {
      const prepared: CliTarget =
        overrideFile === undefined
          ? target
          : {...target, overrideConfigFile: overrideFile};
      return await runCli(
        argumentsOf(prepared),
        prepared.environment,
        secrets,
        read,
        onEvent,
        cancellation,
        onStdin,
      );
    } finally {
      if (overrideFile !== undefined) {
        await overrides.remove(overrideFile).catch((caught: unknown) => {
          logger.warn(
            `could not remove the override file ${overrideFile}: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        });
      }
    }
  }

  /** One run of a `templates` subcommand: no target and no override; its stderr lines go to `onLine`. */
  async function driveTemplates<Result extends {kind: string}>(
    cliArguments: string[],
    read: (result: string | undefined, status: number | null) => Result,
    onLine: (line: string) => void,
    cancellation: AbortSignal,
  ): Promise<Result | CliFailure> {
    const {own, release} = linkedAbort(cancellation);
    try {
      const finished = await host.run(
        cliArguments,
        ({stream, line}) => {
          if (stream === 'stderr') {
            onLine(withoutControlSequences(line));
          }
        },
        own.signal,
      );
      if (finished.kind === 'spawnFailed') {
        return {kind: 'spawnFailed', message: finished.message};
      }
      return cancellation.aborted
        ? {kind: 'cancelled'}
        : read(finished.result, finished.status);
    } finally {
      release();
    }
  }

  return {
    // eslint-disable-next-line id-length -- the bridge's method is named up
    up: (target, options, onEvent, cancellation, onStdin) =>
      drive(
        target,
        prepared => upArguments(prepared, options),
        readUpResult,
        onEvent,
        cancellation,
        onStdin,
      ),
    runUserCommands: (
      target,
      containerId,
      onEvent,
      cancellation,
      onStdin,
      options,
    ) =>
      drive(
        target,
        prepared => runUserCommandsArguments(prepared, containerId, options),
        readRunUserCommandsResult,
        onEvent,
        cancellation,
        onStdin,
      ),
    readConfiguration: (target, containerId, onEvent, cancellation, onStdin) =>
      drive(
        target,
        prepared => readConfigurationArguments(prepared, containerId),
        (result, status, lastError) =>
          readConfigurationResult(result, lastError),
        onEvent,
        cancellation,
        onStdin,
      ),
    setUp: async (target, onEvent, cancellation, onStdin) => {
      const configText =
        target.configFile === undefined
          ? ''
          : await files.readText(target.configFile).catch(() => '');
      return runCli(
        setUpArguments(target),
        target.environment,
        referencedSecrets(configText, editorEnvironment),
        (result, status) => readSetUpResult(result, status),
        onEvent,
        cancellation,
        onStdin,
      );
    },
    applyTemplate: (request, onLine, cancellation) =>
      driveTemplates(
        applyTemplateArguments(request),
        readApplyTemplateResult,
        onLine,
        cancellation,
      ),
    outdated: (target, cancellation) =>
      driveTemplates(
        outdatedArguments(target),
        readOutdatedResult,
        () => undefined,
        cancellation,
      ),
    templateMetadata: (templateId, cancellation) =>
      driveTemplates(
        templateMetadataArguments(templateId),
        readTemplateMetadataResult,
        () => undefined,
        cancellation,
      ),
  };
}
