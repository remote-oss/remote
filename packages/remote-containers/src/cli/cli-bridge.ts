/**
 * @fileoverview What the other components call to drive the dev container CLI: for each subcommand, the target read,
 * the override pre-pass run, the CLI run through the host, and the result and the events scrubbed of the user's
 * secrets before they leave. Nothing here shows anything or decides anything about reuse.
 */

import type {Logger} from 'lib-log';
import {
  type CliTarget,
  readConfigurationArguments,
  runUserCommandsArguments,
  upArguments,
  type UpOptions,
} from './cli-arguments.ts';
import type {CliHost} from './cli-host.ts';
import {
  type CliEvent,
  type CliFailure,
  type ConfigurationResult,
  readStderrLine,
  readConfigurationResult,
  readRunUserCommandsResult,
  readUpResult,
  type RunUserCommandsResult,
  type UpResult,
} from './cli-lines.ts';
import {rawHoldOf} from './cli-raw-lines.ts';
import {referencedSecrets, scrubbed, type Secret} from './cli-secrets.ts';
import {overrideText} from './override-pre-pass.ts';
import type {OverrideStore} from './override-files.ts';

/** How long the CLI may keep running after its result line before it is ended. */
const GUARD_MILLISECONDS = 30_000;

/** What the components call. */
export interface CliBridge {
  up(
    target: CliTarget,
    options: UpOptions,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
  ): Promise<UpResult>;
  runUserCommands(
    target: CliTarget,
    containerId: string,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
  ): Promise<RunUserCommandsResult>;
  readConfiguration(
    target: CliTarget,
    containerId: string | undefined,
    onEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
  ): Promise<ConfigurationResult | CliFailure>;
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

/** The CLI bridge over its host, the client's files, the override store and the editor's environment. */
export function cliBridgeOf(
  host: CliHost,
  files: BridgeFiles,
  overrides: OverrideStore,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): CliBridge {
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
  ): Promise<Result | CliFailure> {
    const configText = await files.readText(target.configFile).catch(() => '');
    const secrets = referencedSecrets(configText, editorEnvironment);
    const rewritten = overrideText(configText, editorEnvironment);
    const overrideFile =
      rewritten === undefined ? undefined : await overrides.write(rewritten);
    try {
      const prepared: CliTarget =
        overrideFile === undefined
          ? target
          : {...target, overrideConfigFile: overrideFile};
      const own = new AbortController();
      function forward(): void {
        own.abort();
      }
      if (cancellation.aborted) {
        forward();
      }
      cancellation.addEventListener('abort', forward, {once: true});
      let lastError: string | undefined;
      const rawHold = rawHoldOf();
      function deliver(unscrubbed: CliEvent): void {
        const event = scrubbedEvent(unscrubbed, secrets);
        if (event.kind === 'log') {
          lastError = firstLine(event.text);
        }
        onEvent(event);
      }
      let guard: NodeJS.Timeout | undefined;
      try {
        const finished = await host.run(
          argumentsOf(prepared),
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
              return;
            }
            rawHold.release(read.channel).forEach(deliver);
            deliver(read.event);
          },
          own.signal,
        );
        rawHold.releaseAll().forEach(deliver);
        if (finished.kind === 'spawnFailed') {
          return {kind: 'spawnFailed', message: finished.message};
        }
        if (cancellation.aborted) {
          return {kind: 'cancelled'};
        }
        return scrubbedResult(
          read(finished.result, finished.status, lastError),
          secrets,
        );
      } finally {
        clearTimeout(guard);
        cancellation.removeEventListener('abort', forward);
      }
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

  return {
    // eslint-disable-next-line id-length -- the bridge's method is named up
    up: (target, options, onEvent, cancellation) =>
      drive(
        target,
        prepared => upArguments(prepared, options),
        readUpResult,
        onEvent,
        cancellation,
      ),
    runUserCommands: (target, containerId, onEvent, cancellation) =>
      drive(
        target,
        prepared => runUserCommandsArguments(prepared, containerId),
        readRunUserCommandsResult,
        onEvent,
        cancellation,
      ),
    readConfiguration: (target, containerId, onEvent, cancellation) =>
      drive(
        target,
        prepared => readConfigurationArguments(prepared, containerId),
        (result, status, lastError) =>
          readConfigurationResult(result, lastError),
        onEvent,
        cancellation,
      ),
  };
}
