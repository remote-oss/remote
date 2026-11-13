import type {Sink} from '../logger.ts';
import {plainLineOf} from './line-format.ts';

/** What a file sink writes through, and how it is told of a failure. */
export interface FileSinkOptions {
  /** Appends `text` to the file. */
  append(text: string): Promise<void>;
  /** Called with what an append rejected with; the lines after it are still written. */
  onFailure(caught: unknown): void;
  /** The named secrets redacted from every line. */
  secrets?: () => readonly string[];
}

/**
 * A sink that appends each line, in the plain format and one to a line, through `append`. The appends run one after
 * the other, in the order of the lines.
 */
export function createFileSink(options: FileSinkOptions): Sink {
  let queue: Promise<void> = Promise.resolve();
  return {
    write(line): void {
      const text = `${plainLineOf(line, options.secrets?.() ?? [])}\n`;
      queue = queue.then(() => options.append(text)).catch(options.onFailure);
    },
  };
}
