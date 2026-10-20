import type {ChannelPort, RevealableChannel} from '../sinks/editor-port.ts';

/** A real output channel that notes the lines, reveals and disposals it is given. */
export class NotingChannel implements RevealableChannel {
  readonly lines: string[] = [];

  readonly shown: Array<boolean | undefined> = [];

  disposed = 0;

  /** Notes the line. */
  appendLine(text: string): void {
    this.lines.push(text);
  }

  /** Notes the reveal and whether it keeps the focus. */
  show(preserveFocus?: boolean): void {
    this.shown.push(preserveFocus);
  }

  /** Counts the disposal. */
  dispose(): void {
    this.disposed += 1;
  }
}

/** A real channel port that hands out one noting channel and remembers the names it was asked for. */
export class NotingChannels implements ChannelPort {
  readonly channel = new NotingChannel();

  readonly names: string[] = [];

  /** Notes the name and gives the one channel. */
  createOutputChannel(name: string): RevealableChannel {
    this.names.push(name);
    return this.channel;
  }
}

/** Text appended to files, kept by file. */
export class AppendedText {
  readonly appended = new Map<string, string>();

  /** Adds the text to the end of the file's text. */
  readonly append = (file: string, text: string): void => {
    this.appended.set(file, `${this.appended.get(file) ?? ''}${text}`);
  };
}
