/**
 * @fileoverview The Docker CLI as the extension's other modules see it: a one-shot run that collects what the command
 * prints, and a spawn that hands back the live process with piped streams. Nothing outside the adapter starts a
 * `docker` process.
 */

/** Where a `docker` run gets its input: nothing, a text, or a local file's bytes streamed unchanged. */
export type EngineInput =
  | {kind: 'none'}
  | {kind: 'text'; text: string}
  | {kind: 'file'; localFile: string};

/** How a one-shot `docker` run ended: it ran (`status` undefined for a signal), or it couldn't start. */
export type EngineRunOutcome =
  | {kind: 'ran'; status: number | undefined; stdout: string; stderr: string}
  | {kind: 'failed'; detail: string};

/** What a run or a spawn is given. `environment` is added to the editor's environment for this `docker` process only. */
export interface EngineOptions {
  environment?: Readonly<Record<string, string>>;
  cancellation: AbortSignal;
}

/** A live `docker` process with piped standard streams. */
export interface EngineProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  /** Settles once with the exit status, or undefined for a signal. */
  exited: Promise<number | undefined>;
  kill(): void;
}

/** A spawn that started, or why it couldn't (the system's message). */
export type EngineSpawn =
  {kind: 'spawned'; process: EngineProcess} | {kind: 'failed'; detail: string};

/** The Docker CLI at `dockerPath`. `argv` is `docker`'s arguments, without the program. */
export interface EngineHost {
  run(
    argv: readonly string[],
    input: EngineInput,
    options: EngineOptions,
  ): Promise<EngineRunOutcome>;
  spawn(argv: readonly string[], options: EngineOptions): Promise<EngineSpawn>;
}
