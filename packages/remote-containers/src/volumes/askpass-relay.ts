/**
 * @fileoverview The askpass relay of a clone's checks on the host: an endpoint in the extension host that the launcher
 * git and ssh run connects to, each question shown to the user as its kind says, and the variables that make git and
 * ssh use it. No answer is kept or logged.
 */

import {
  AskpassEndpoint,
  askpassEnvironment,
  type EndpointPort,
  type LauncherFiles,
  type Scheduler,
  DEFAULT_FIRST_MESSAGE_MILLISECONDS,
  installLauncher,
} from 'lib-helper';
import {type ClonePromptSurface, classifyClonePrompt} from './git-prompts.ts';

/** What the relay is made from. */
export interface AskpassRelayPorts {
  port: EndpointPort;
  files: LauncherFiles;
  scheduler: Scheduler;
  /** The endpoint's path, the launcher's folder, the editor's runtime and the bundled askpass program. */
  places: {
    endpoint: string;
    runtimeFolder: string;
    runtime: string;
    program: string;
  };
  /** A new unguessable nonce. */
  newNonce: () => string;
  /** Shows one question and gives the answer, or nothing when the user dismissed it or `cancellation` ended it. */
  askUser(
    question: {surface: ClonePromptSurface; text: string},
    cancellation: AbortSignal,
  ): Promise<string | undefined>;
  logLine: (line: string) => void;
}

/** An open relay: the variables a git call takes, and its end. */
export interface AskpassRelay {
  environment: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

/** Opens the relay: the endpoint listens, the launcher is written, and each question opens the user's surface. */
export async function openAskpassRelay(
  ports: AskpassRelayPorts,
): Promise<AskpassRelay> {
  const nonce = ports.newNonce();
  const asking = new AbortController();
  const endpoint = new AskpassEndpoint<ClonePromptSurface>({
    nonce,
    classify: classifyClonePrompt,
    scheduler: ports.scheduler,
    firstMessageMilliseconds: DEFAULT_FIRST_MESSAGE_MILLISECONDS,
    logLine: ports.logLine,
    onPrompt: prompt => {
      void ports.askUser(prompt, asking.signal).then(answer => {
        if (answer === undefined) {
          endpoint.refuse(prompt.promptId);
        } else {
          endpoint.answer(prompt.promptId, answer);
        }
      });
    },
    onPromptClosed: () => undefined,
  });
  const listening = await ports.port.listen(
    ports.places.endpoint,
    connection => {
      endpoint.accept(connection);
    },
  );
  const launcher = await installLauncher(
    ports.files,
    ports.places.runtimeFolder,
    ports.places.runtime,
    ports.places.program,
  );
  const environment = {
    ...askpassEnvironment({
      launcher,
      endpoint: ports.places.endpoint,
      nonce,
      external: false,
    }),
    GIT_ASKPASS: launcher,
  };
  return {
    environment,
    close: async () => {
      asking.abort();
      endpoint.closeAll();
      await listening.close();
    },
  };
}
