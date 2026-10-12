/**
 * @fileoverview A scripted `ssh` or `scp` client process for the host channel tests: it records what it was given
 * and answers as its script says, on a later turn of the event loop so that the code under test has attached.
 */

import {createHash} from 'node:crypto';
import type {
  ProcessHandle,
  ProcessSpawner,
  ProcessSpecification,
} from '../../src/index.ts';

/** What a fake process does once started. */
export type ClientScript = (process: FakeClientProcess) => void;

/** A started fake client. */
export class FakeClientProcess implements ProcessHandle {
  /** What the process was started with. */
  readonly specification: ProcessSpecification;
  /** The pieces written to its input. */
  readonly input: Uint8Array[] = [];
  /** Whether the input was closed. */
  inputEnded = false;
  /** Whether the process was killed. */
  killed = false;
  private readonly outputListeners: Array<(chunk: string) => void> = [];
  private readonly errorListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<(status: number | undefined) => void> =
    [];
  private exited = false;
  private readonly onInputEnd: Array<() => void> = [];

  /** A process for `specification`. */
  constructor(specification: ProcessSpecification) {
    this.specification = specification;
  }

  /** Listens to standard output. */
  onOutput(listener: (chunk: string) => void): void {
    this.outputListeners.push(listener);
  }

  /** Listens to standard error. */
  onError(listener: (chunk: string) => void): void {
    this.errorListeners.push(listener);
  }

  /** Listens to the end of the process. */
  onExit(listener: (status: number | undefined) => void): void {
    this.exitListeners.push(listener);
  }

  /** Records a write to the input. */
  write(data: string | Uint8Array): Promise<void> {
    this.input.push(
      typeof data === 'string' ? new TextEncoder().encode(data) : data,
    );
    return Promise.resolve();
  }

  /** Closes the input. */
  endInput(): void {
    this.inputEnded = true;
    this.onInputEnd.forEach(listener => {
      listener();
    });
  }

  /** Kills the process, which then ends without a status. */
  kill(): void {
    this.killed = true;
    this.exit(undefined);
  }

  /** Everything written to the input, as one text. */
  inputText(): string {
    return new TextDecoder().decode(Buffer.concat(this.input));
  }

  /** Writes to standard output. */
  output(chunk: string): void {
    this.outputListeners.forEach(listener => {
      listener(chunk);
    });
  }

  /** Writes to standard error. */
  error(chunk: string): void {
    this.errorListeners.forEach(listener => {
      listener(chunk);
    });
  }

  /** Ends the process once; later calls do nothing. */
  exit(status: number | undefined): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.exitListeners.forEach(listener => {
      listener(status);
    });
  }

  /** Calls `listener` when the input has been closed, at once when it already is. */
  whenInputEnds(listener: () => void): void {
    if (this.inputEnded) {
      listener();
      return;
    }
    this.onInputEnd.push(listener);
  }

  /**
   * The remote command reads `prefix` from its input before the script's own input does; this prints the SHA-256 of
   * the rest once the input is closed, then exits 0.
   */
  digestInputThenExit(prefix: Uint8Array): void {
    this.whenInputEnds(() => {
      const bytes = Buffer.concat(this.input).subarray(prefix.length);
      this.output(`${createHash('sha256').update(bytes).digest('hex')}\n`);
      this.exit(0);
    });
  }
}

/** A spawner that starts fake processes by script and keeps them. */
export class ScriptedSpawner {
  /** Every start, failed ones included, in order. */
  readonly started: FakeClientProcess[] = [];
  /** Each start takes the next script; the last one repeats. */
  private readonly scripts: Array<ClientScript | Error>;

  /** A spawner whose starts follow `scripts` in turn; an Error makes that start fail. */
  constructor(...scripts: Array<ClientScript | Error>) {
    this.scripts = scripts;
  }

  /** The spawner to pass to the code under test. */
  readonly spawn: ProcessSpawner = specification => {
    const position = Math.min(this.started.length, this.scripts.length - 1);
    const script = this.scripts[position];
    if (script instanceof Error) {
      this.started.push(new FakeClientProcess(specification));
      return Promise.reject(script);
    }
    const process = new FakeClientProcess(specification);
    this.started.push(process);
    setImmediate(() => {
      script?.(process);
    });
    return Promise.resolve(process);
  };
}

/** An error as the system reports a failed start. */
export function startError(code: string, message = code): Error {
  return Object.assign(new Error(message), {code});
}
