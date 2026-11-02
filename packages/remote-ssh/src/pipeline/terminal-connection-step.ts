/**
 * @fileoverview The connection step of a connect without the shared connection: the install terminal runs the window's
 * own `ssh`, the login's questions are shown from its output, and the login ends at the line that says the user is
 * authenticated. The server steps then run their scripts over that terminal. Its end ends the window's connection.
 */

import type {Logger} from 'lib-log';
import type {HostChannel} from 'lib-host';
import type {Scheduler} from 'lib-helper';
import {
  buildInvocation,
  classify,
  ConnectWait,
  connectWaitMilliseconds,
  type ConnectWaitSettings,
  bootstrapLogLine,
  type BootstrapEvent,
  type ConnectionNotice,
  LineSplitter,
  type LoginTerminals,
  followLoginOutput,
  PromptReader,
  type SessionRunner,
  connectionStart,
  sessionStartFor,
  setupMarkerOf,
  type SshRequest,
  type TerminalEnd,
  TerminalSessionRunner,
  type TerminalLogin,
} from 'lib-ssh';
import {goesOnAfterLoginTimeout} from './connection-request.ts';
import {CONNECT_WAIT_TIMEOUT} from './failure.ts';
import {isForwardingLine, logSshLines} from './ssh-log.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectionTerms,
  ConnectSteps,
  StepFailure,
  StepResult,
} from './steps.ts';

/** What the terminal connection step is made from. */
export interface TerminalConnectionDependencies {
  terminals: LoginTerminals;
  /**
   * The install connection's request for this connect: the remote program `sh`, and with dynamic forwarding on our `-D`
   * port; with it off, the user's own forwards are cleared.
   */
  installRequest(
    input: ConnectInput,
    terms: ConnectionTerms,
    socksPort: number | undefined,
  ): SshRequest;
  /** Whether the window tunnel takes the SOCKS path, so the install `ssh` holds the `-D`. */
  dynamicForwarding(): boolean;
  /** A free loopback port for the `-D`, bound and released. */
  freePort(): Promise<number>;
  scheduler: Scheduler;
  newMarker(): string;
  /** The channel over the install terminal's runner for the server steps. */
  channelFor(
    runner: SessionRunner,
    terms: ConnectionTerms,
    input: ConnectInput,
  ): HostChannel;
  /** Shows the login's questions for this connect; the returned handle takes an open input down. */
  attachQuestions(
    login: TerminalLogin,
    input: ConnectInput,
  ): {onQuestion(text: string): void; dispose(): void};
  /** `remote.SSH.showLoginTerminal`, read once per attempt. */
  revealLoginTerminals(): boolean;
  /** What decides the length of the connect wait: the timeout, whether the host set it, and the ceiling. */
  connectWait(): ConnectWaitSettings;
  logger: Logger;
}

/**
 * The failure of a login that did not reach the handover, as the pipeline reads it. A terminal that ended with no exit
 * code and no output, and that the user did not close, never started: the editor's trust question was cancelled.
 */
function failureOf(end: TerminalEnd, lines: readonly string[]): StepFailure {
  if (end.code === undefined && !end.hadOutput && end.reason !== 'user') {
    return {kind: 'cancelled', reason: {id: 'trustRefused'}};
  }
  const classification = classify(lines, end.code, 'connection', 'terminal');
  return {
    kind: classification.kind,
    ...(classification.reason === undefined
      ? {}
      : {reason: classification.reason}),
    hints: classification.hints,
    ...(end.code === undefined ? {} : {sshExitStatus: end.code}),
  };
}

/** The step that opens the connection of a connect in terminal mode. */
export function openTerminalConnectionStep(
  dependencies: TerminalConnectionDependencies,
): ConnectSteps['openConnection'] {
  return async (input, terms, cancellation) => {
    const socksPort = dependencies.dynamicForwarding()
      ? await dependencies.freePort()
      : undefined;
    if (cancellation.aborted) {
      return {kind: 'failed', failure: {kind: 'cancelled'}};
    }
    const revealed = dependencies.revealLoginTerminals();
    const terminal = dependencies.terminals.open(
      buildInvocation(dependencies.installRequest(input, terms, socksPort)),
      'install',
      revealed,
    );
    return new Promise<StepResult<ConnectionLease>>(settle => {
      const lines: string[] = [];
      const waitSettings = dependencies.connectWait();
      const goesOn = goesOnAfterLoginTimeout(terms);
      let handedOver = false;
      let authenticated = false;
      let finished = false;
      const asking: {
        questions?: {onQuestion(text: string): void; dispose(): void};
      } = {};
      const noticeListeners: Array<(notice: ConnectionNotice) => void> = [];
      let disposed = false;

      function disposeTerminal(): void {
        if (!disposed) {
          disposed = true;
          terminal.dispose();
        }
      }

      function dropQuestions(): void {
        asking.questions?.dispose();
        delete asking.questions;
      }

      function takeDown(): void {
        wait.stop();
        reader.stop();
        dropQuestions();
        cancellation.removeEventListener('abort', onAbort);
      }

      function fail(failure: StepFailure): void {
        if (finished) {
          return;
        }
        finished = true;
        takeDown();
        disposeTerminal();
        settle({kind: 'failed', failure});
      }

      function onAbort(): void {
        fail({kind: 'cancelled'});
      }

      const wait = new ConnectWait(waitSettings, dependencies.scheduler, () => {
        fail(CONNECT_WAIT_TIMEOUT);
      });
      const reader = new PromptReader(
        dependencies.scheduler,
        connectWaitMilliseconds(waitSettings),
        {
          onQuestion: text => {
            asking.questions?.onQuestion(text);
          },
          onUnreachable: () => {
            fail(CONNECT_WAIT_TIMEOUT);
          },
        },
      );
      if (!revealed) {
        asking.questions = dependencies.attachQuestions(
          {terminal, reader},
          input,
        );
      }

      function startSession(): void {
        authenticated = true;
        reader.stop();
        dropQuestions();
        // The login shell's startup gets a wait of its own, as long as the bootstrap's bound; a session that goes on after
        // the bound waits for the script's start as well.
        wait.start(goesOn ? 2 : 1);
        const runner: TerminalSessionRunner = new TerminalSessionRunner({
          terminal,
          scheduler: dependencies.scheduler,
          prelude: connectionStart(
            sessionStartFor(waitSettings, goesOn),
            terms.remoteCommandInEffect,
          ).prelude,
          newMarker: () => dependencies.newMarker(),
          onBootstrap: event => {
            hearBootstrap(event, runner);
          },
        });
      }

      function hearBootstrap(
        event: BootstrapEvent,
        runner: TerminalSessionRunner,
      ): void {
        if (finished) {
          return;
        }
        if (event.kind === 'ready') {
          handOver(runner);
          return;
        }
        dependencies.logger.info(bootstrapLogLine(event));
        if (event.kind === 'timeout' && goesOn) {
          dependencies.logger.warn(
            `going on with ssh's environment: ${bootstrapLogLine(event)}`,
          );
          return;
        }
        fail(
          event.kind === 'timeout' ? CONNECT_WAIT_TIMEOUT : {kind: 'unknown'},
        );
      }

      function handOver(runner: TerminalSessionRunner): void {
        handedOver = true;
        finished = true;
        takeDown();
        let channel: HostChannel;
        try {
          channel = dependencies.channelFor(runner, terms, input);
        } catch (caught) {
          disposeTerminal();
          settle({
            kind: 'failed',
            failure: {kind: 'unknown', logDetail: String(caught)},
          });
          return;
        }
        settle({
          kind: 'done',
          value: {
            channel,
            waits: undefined,
            socksPort: socksPort ?? 0,
            storedRecord: undefined,
            storeSharedRecord: () => Promise.resolve(false),
            onNotice: listener => {
              noticeListeners.push(listener);
              return () => {
                noticeListeners.splice(noticeListeners.indexOf(listener), 1);
              };
            },
            answer: () => Promise.resolve(false),
            refuse: () => Promise.resolve(false),
            release: disposeTerminal,
          },
        });
      }

      const splitter = new LineSplitter(line => {
        lines.push(line);
        if (
          !authenticated &&
          !finished &&
          setupMarkerOf(line) === 'authenticated'
        ) {
          startSession();
        }
      });
      // ssh's own lines are logged up to its authentication; after it the terminal also holds the bootstrap's echo and
      // the remote shell, so only ssh's lines for a channel or a forward go on being logged.
      let sshPhase = true;
      const sshOutput = new LineSplitter(line => {
        if (sshPhase || isForwardingLine(line)) {
          logSshLines(dependencies.logger, [line], undefined);
        }
        if (sshPhase && setupMarkerOf(line) === 'authenticated') {
          sshPhase = false;
        }
      });
      terminal.onOutput(text => {
        sshOutput.push(text);
      });
      followLoginOutput(terminal, {
        isFinished: () => finished,
        onFirstOutput: () => {
          wait.stop();
        },
        reader,
        lines: splitter,
      });
      terminal.onEnd(end => {
        if (handedOver) {
          for (const listener of [...noticeListeners]) {
            listener({type: 'transportLost'});
          }
          return;
        }
        splitter.flush();
        fail(failureOf(end, lines));
      });
      cancellation.addEventListener('abort', onAbort);
      wait.start();
    });
  };
}
