/**
 * @fileoverview The askpass program `ssh` runs: it hands the question to the helper's askpass endpoint and prints
 * the answer on standard output. It exits 1 when the question is refused, which `ssh` takes as a cancelled prompt; a
 * refused permission question (`ssh` sets `SSH_ASKPASS_PROMPT` to `confirm`) is answered with an empty line, which
 * `ssh` takes as allowed.
 */

import type {EndpointPort} from 'lib-helper';
import {readAskReply} from './messages.ts';

/** The variable that names the helper's askpass endpoint. */
export const ENDPOINT_VARIABLE = 'REMOTE_OSS_ASKPASS_ENDPOINT';

/** The variable that carries the helper's askpass nonce. */
export const NONCE_VARIABLE = 'REMOTE_OSS_ASKPASS_NONCE';

/** The variable in which `ssh` says what kind of question it asks, and its value for a question of permission. */
const PROMPT_VARIABLE = 'SSH_ASKPASS_PROMPT';

const PERMISSION_PROMPT = 'confirm';

/** What the program runs on. */
export interface AskpassProgramEnvironment {
  /** The arguments `ssh` passed: the question is the first. */
  programArguments: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  port: EndpointPort;
  /** Writes to standard output. */
  output: (text: string) => void;
}

const EXIT_ANSWERED = 0;
const EXIT_REFUSED = 1;
const EXIT_MISUSED = 2;

/** Asks the question and prints the answer; resolves to the exit status. Nothing it handles is logged. */
export async function runAskpassProgram(
  askpass: AskpassProgramEnvironment,
): Promise<number> {
  const endpoint = askpass.environment[ENDPOINT_VARIABLE];
  const nonce = askpass.environment[NONCE_VARIABLE];
  const [question] = askpass.programArguments;
  if (endpoint === undefined || nonce === undefined || question === undefined) {
    return EXIT_MISUSED;
  }
  try {
    const connection = await askpass.port.connect(endpoint);
    const answer = new Promise<string | undefined>(resolve => {
      connection.onMessage(value => {
        resolve(readAskReply(value)?.text);
      });
      connection.onClose(() => {
        resolve(undefined);
      });
    });
    connection.send({type: 'ask', nonce, text: question});
    const text = await answer;
    if (text === undefined) {
      if (askpass.environment[PROMPT_VARIABLE] === PERMISSION_PROMPT) {
        askpass.output('\n');
        return EXIT_ANSWERED;
      }
      return EXIT_REFUSED;
    }
    askpass.output(`${text}\n`);
    return EXIT_ANSWERED;
  } catch {
    // An endpoint that cannot be reached refuses the question like one that closes.
    return EXIT_REFUSED;
  }
}
