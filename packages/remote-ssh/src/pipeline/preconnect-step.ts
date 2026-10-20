/**
 * @fileoverview The pre-connection script step: it asks the user before a script runs, remembers the choice not to be
 * asked again for the contents it was given, runs the script on the local machine with its output in the log, and
 * fails the connect when the script does.
 */

import type {FailureReason} from 'lib-authority';
import type {ProcessHandle} from 'lib-ssh';
import {contentHashOf} from '../preconnect/approvals.ts';
import type {PreconnectPorts} from '../preconnect/ports.ts';
import {expandedPath, programPath} from '../preconnect/script-path.ts';
import {textOfId} from '../surfaces/failure-strings.ts';
import {
  hostAlias,
  type PreconnectChoice,
  preconnectChoiceOf,
} from './host-settings.ts';
import type {ConnectSteps, StepResult} from './steps.ts';

/** What the step reads and shows. */
export interface PreconnectStepDependencies {
  /** The value of `remote.SSH.preconnect`, as the user wrote it; read for each connect. */
  setting: () => unknown;
  ports: PreconnectPorts;
  /** Tells that the script's stage began, which shows its progress text until the step ends. */
  onRunning: () => void;
  /** Wraps a question so that the progress opens before it is shown. */
  prompting: <Arguments extends unknown[], Result>(
    question: (...argumentList: Arguments) => Result,
  ) => (...argumentList: Arguments) => Result;
}

/** The failure of the step, with the text it shows after the host's name; none for a wait that was given up. */
type Failure = Extract<StepResult<undefined>, {kind: 'failed'}>;

/** The name of the stage's word for each kind of value that is not a path. */
const VALUE_KIND_IDS = {
  number: 'preconnectValueNumber',
  boolean: 'preconnectValueBoolean',
  object: 'preconnectValueObject',
  list: 'preconnectValueList',
} as const;

/** One piece of output as a log line: the text without one trailing line feed. */
function lineOf(chunk: string): string {
  return chunk.endsWith('\n') ? chunk.slice(0, -1) : chunk;
}

/** A template as it is, the English text. */
function english(template: string): string {
  return template;
}

/** The message of whatever a port rejected with. */
function messageOf(error: unknown): string {
  return (error as Error).message;
}

/** The step over `remote.SSH.preconnect`. */
export function preconnectStep(
  dependencies: PreconnectStepDependencies,
): ConnectSteps['preconnect'] {
  const {ports} = dependencies;
  const {logger} = ports;
  const askUser = dependencies.prompting(
    (path: string, changed: boolean, cancellation: AbortSignal) =>
      ports.dialog.askUser(path, changed, cancellation),
  );

  /** The failure with this text, and the two error lines the log gets for it. */
  function failed(reason: FailureReason, detail: string): Failure {
    logger.error(`the pre-connection script failed: ${detail}`);
    logger.error(
      `[PreconnectScriptFailure]: The pre-connect script has failed (${detail})`,
    );
    return {
      kind: 'failed',
      failure: {kind: 'preconnectFailed', reason},
    };
  }

  function failedWithText(detail: string): Failure {
    return failed({text: detail}, detail);
  }

  /** The failure of a value that is not a path, naming the host and the kind of the value. */
  function notAPath(
    alias: string,
    choice: Extract<PreconnectChoice, {kind: 'notAPath'}>,
  ): Failure {
    const kindId = VALUE_KIND_IDS[choice.valueKind];
    const reason: FailureReason = {
      id: 'preconnectNotAPath',
      values: [alias, {id: kindId, values: []}],
    };
    return failed(
      reason,
      textOfId('preconnectNotAPath', english, [
        alias,
        textOfId(kindId, english),
      ]),
    );
  }

  /** Runs the script at `expanded` and waits for it to end or for the connect to stop waiting. */
  async function runScript(
    expanded: string,
    cancellation: AbortSignal,
  ): Promise<StepResult<undefined>> {
    const program = programPath(expanded, ports.workingDirectory);
    try {
      if (!(await ports.exists(program))) {
        return failedWithText(`script not found: ${expanded}`);
      }
    } catch (error) {
      return failedWithText(messageOf(error));
    }
    logger.info(`running the pre-connection script ${expanded}`);
    let handle: ProcessHandle;
    try {
      handle = await ports.spawner({
        program,
        programArguments: [],
        environment: ports.environment,
      });
    } catch (error) {
      return failedWithText(messageOf(error));
    }
    handle.onOutput(chunk => {
      logger.info(`[preconnect] ${lineOf(chunk)}`);
    });
    handle.onError(chunk => {
      logger.info(`[preconnect (stderr)] ${lineOf(chunk)}`);
    });
    const ended = new Promise<number | undefined>(resolve => {
      handle.onExit(resolve);
    });
    handle.endInput();
    const stopped = new Promise<'stopped'>(resolve => {
      cancellation.addEventListener('abort', () => {
        resolve('stopped');
      });
    });
    const outcome = await Promise.race([ended, stopped]);
    if (outcome === 'stopped') {
      logger.info(
        'the pre-connection step stopped waiting; the script is left to finish',
      );
      return {kind: 'failed', failure: {kind: 'preconnectFailed'}};
    }
    if (outcome === 0) {
      return {kind: 'done', value: undefined};
    }
    return failedWithText(
      outcome === undefined
        ? 'ended by a signal'
        : `non-zero exit code ${String(outcome)}`,
    );
  }

  /** The contents of the file, or the failure that its reading gave. */
  async function contentsOf(
    expanded: string,
  ): Promise<{bytes: Uint8Array} | {failure: Failure}> {
    try {
      return {bytes: await ports.readFile(expanded)};
    } catch (error) {
      return {failure: failedWithText(messageOf(error))};
    }
  }

  return async (input, cancellation) => {
    const alias = hostAlias(input.target);
    const choice = preconnectChoiceOf(dependencies.setting(), alias);
    if (choice.kind === 'none') {
      return {kind: 'done', value: undefined};
    }
    dependencies.onRunning();
    if (choice.kind === 'notAPath') {
      return notAPath(alias, choice);
    }
    const expanded = expandedPath(choice.path, ports.home);
    const stored = ports.approvals.hashFor(expanded);
    let changed = false;
    if (stored !== undefined) {
      const read = await contentsOf(expanded);
      if ('failure' in read) {
        return read.failure;
      }
      if (contentHashOf(read.bytes) === stored) {
        return runScript(expanded, cancellation);
      }
      logger.info(
        "the pre-connection script's contents have changed since the last confirmation",
      );
      changed = true;
    }
    const answer = await askUser(expanded, changed, cancellation);
    if (answer === 'aborted') {
      return {kind: 'failed', failure: {kind: 'preconnectFailed'}};
    }
    if (answer === 'skip') {
      logger.info('the user skipped the pre-connection script');
      return {kind: 'done', value: undefined};
    }
    if (answer === 'allowAlways') {
      const read = await contentsOf(expanded);
      if ('failure' in read) {
        return read.failure;
      }
      await ports.approvals.remember(expanded, contentHashOf(read.bytes));
    }
    return runScript(expanded, cancellation);
  };
}
