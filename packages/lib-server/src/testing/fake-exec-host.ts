/**
 * @fileoverview A host's command as the exec server gives it, for the rows of everything that runs a process on a
 * remote host: a command that sends the lines it is told to, echoes its input when that ends, and exits as told.
 */

import type {
  ExecReadStream,
  ExecServer,
  ExecSpawnedCommand,
  ExecSpawnOptions,
} from '../cli-control/exec-server.ts';

/** The process id the fake host's shell reports. */
export const PROCESS_ID = 4242;

/** The exit status of a process the fake host kills. */
export const KILLED_STATUS = 137;

/** A host stream the test feeds, then ends, or ends with a rejection. */
export function hostStream(): {
  stream: ExecReadStream;
  send(text: string): void;
  end(): void;
  fail(): void;
} {
  let listener: ((data: Uint8Array) => void) | undefined;
  let ended: (() => void) | undefined;
  let failed: ((reason: Error) => void) | undefined;
  const onEnd = new Promise<void>((resolve, reject) => {
    ended = resolve;
    failed = reject;
  });
  return {
    stream: {
      onDidReceiveMessage: given => {
        listener = given;
        return {
          dispose: () => {
            listener = undefined;
          },
        };
      },
      onEnd,
    },
    send: text => listener?.(new TextEncoder().encode(text)),
    end: () => {
      ended?.();
    },
    fail: () => {
      failed?.(new Error('the stream broke'));
    },
  };
}

/** How the fake host's one command behaves. */
export interface Behaviour {
  status?: number;
  complaint?: string;
  refuse?: boolean;
  firstLines?: readonly string[];
  ignoresInput?: boolean;
  killFails?: boolean;
  closesAtOnce?: boolean;
}

/** What the fake host was asked, and what reached its command. */
export interface Scene {
  asked: Array<{
    command: string;
    argv: string[];
    options: ExecSpawnOptions | undefined;
  }>;
  input: string[];
  inputEnded: boolean;
  killed: number[];
  server: Pick<ExecServer, 'spawn' | 'kill'>;
}

/**
 * A host whose command first sends `firstLines` (by default its process id's line), then, when its input ends, echoes
 * it on stdout, writes `complaint` on stderr and exits `status`; one that `ignoresInput` runs until it is killed.
 */
export function sceneOf(behaviour: Behaviour = {}): Scene {
  const {
    status = 0,
    complaint = '',
    refuse = false,
    firstLines = [`${String(PROCESS_ID)}\n`],
    ignoresInput = false,
    killFails = false,
    closesAtOnce = false,
  } = behaviour;
  let finish: ((exitStatus: number) => void) | undefined;
  const scene: Scene = {
    asked: [],
    input: [],
    inputEnded: false,
    killed: [],
    server: {
      spawn: (command, argv, options) => {
        if (refuse) {
          return Promise.reject(new Error('the control connection is closed'));
        }
        scene.asked.push({command, argv, options});
        const stdout = hostStream();
        const stderr = hostStream();
        let exited: ((exit: {status: number}) => void) | undefined;
        const onExit = new Promise<{status: number}>(resolve => {
          exited = resolve;
        });
        finish = exitStatus => {
          stdout.send(scene.input.join(''));
          stderr.send(complaint);
          stdout.end();
          stderr.end();
          exited?.({status: exitStatus});
        };
        const spawned: ExecSpawnedCommand = {
          stdin: {
            write: data => {
              scene.input.push(new TextDecoder().decode(data));
            },
            end: () => {
              scene.inputEnded = true;
              if (!ignoresInput) {
                finish?.(status);
              }
            },
          },
          stdout: stdout.stream,
          stderr: stderr.stream,
          onExit,
        };
        setImmediate(() => {
          for (const line of firstLines) {
            stdout.send(line);
          }
          if (closesAtOnce) {
            finish?.(status);
          }
        });
        return Promise.resolve(spawned);
      },
      kill: processId => {
        scene.killed.push(processId);
        if (killFails) {
          return Promise.reject(new Error('no such process'));
        }
        finish?.(KILLED_STATUS);
        return Promise.resolve();
      },
    },
  };
  return scene;
}

/** Lets the timers and promises that are due run. */
export function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
