/**
 * @fileoverview The fakes of the client step's tests, shared with the tests of the connect's wiring: a spawner whose
 * programs answer `-V` and `ssh -G` from a script, and the answers of an OpenSSH client and its lookup.
 */

import type {ProcessHandle, ProcessSpawner} from 'lib-ssh';

/** How a fake run answers: what it prints on each stream and its status, no exit at all, or a start failure. */
export type Answer =
  | {
      kind: 'exit';
      output?: string;
      errorOutput?: string;
      status: number | undefined;
    }
  | {kind: 'hang'}
  | {kind: 'refuse'};

/** What the spawner saw: each run as one line, and the programs it killed. */
export interface Seen {
  started: string[];
  killed: string[];
  /** The environment of each run, in the order of `started`. */
  environments: Array<Readonly<Record<string, string>>>;
}

/** A spawner whose programs answer `-V` from `checks` and `-G` with `lookup`. */
export function spawnerOf(
  checks: Readonly<Record<string, Answer>>,
  lookup: Answer,
  seen: Seen,
): ProcessSpawner {
  return specification => {
    const answer = specification.programArguments.includes('-G')
      ? lookup
      : (checks[specification.program] ?? {kind: 'refuse'});
    if (answer.kind === 'refuse') {
      return Promise.reject(new Error('not found'));
    }
    seen.started.push(
      `${specification.program} ${specification.programArguments.join(' ')}`,
    );
    seen.environments.push(specification.environment);
    function later(
      text: string | undefined,
      listener: (chunk: string) => void,
    ) {
      if (text !== undefined) {
        queueMicrotask(() => {
          listener(text);
        });
      }
    }
    const handle: ProcessHandle = {
      onOutput: listener => {
        later(answer.kind === 'exit' ? answer.output : undefined, listener);
      },
      onError: listener => {
        later(
          answer.kind === 'exit' ? answer.errorOutput : undefined,
          listener,
        );
      },
      onExit: listener => {
        if (answer.kind === 'exit') {
          setTimeout(() => {
            listener(answer.status);
          }, 1);
        }
      },
      write: () => Promise.resolve(),
      endInput: () => undefined,
      kill: () => {
        seen.killed.push(specification.program);
      },
    };
    return Promise.resolve(handle);
  };
}

/** The program name the search path finds. */
export const SSH_PROGRAM = 'ssh';

/** An OpenSSH client's `-V` answer. */
export const OPENSSH: Answer = {
  kind: 'exit',
  errorOutput: 'OpenSSH_9.6p1, OpenSSL 3.0.13',
  status: 0,
};

/** What `ssh -G` prints for a host that sets no connect timeout. */
export const OPTIONS_TEXT = 'hostname dev\nuser alex\nport 22\n';

/** A lookup that prints `OPTIONS_TEXT` and ends well. */
export const LOOKUP: Answer = {kind: 'exit', output: OPTIONS_TEXT, status: 0};
