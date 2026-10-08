import type {LogLine, Sink} from '../logger.ts';

/** A sink that keeps its lines in memory, for tests. */
export class MemorySink implements Sink {
  /** The lines written, in the order written. */
  readonly lines: LogLine[] = [];

  /** Keep the line, unchanged and in order. */
  write(line: LogLine): void {
    this.lines.push(line);
  }
}
