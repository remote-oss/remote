/**
 * @fileoverview The questions a login terminal shows: the plain text of its output, one `LineSplitter` over it, and
 * the moment a recognised question waits at the end of the stream, with a bound for a question nobody can reach.
 */

import type {Scheduler} from 'lib-helper';
import {setupMarkerOf} from '../diagnostics/setup-report.ts';
import {LineSplitter} from '../process/line-splitter.ts';
import {CONTINUE_QUESTION, PASSPHRASE_QUESTION} from '../prompts/classify.ts';

/** How many output lines stand behind the candidate text. */
const LINE_WINDOW = 20;

/** The pause before the pending partial line is matched: a prompt is ssh's last write before it waits. */
export const PARTIAL_LINE_PAUSE_MILLISECONDS = 100;

/** What the reader tells its owner. */
export interface PromptReaderEvents {
  /** A question is waiting: its candidate text, ready for `classifyPrompt`. */
  onQuestion(text: string): void;
  /** No answer can reach a question: the connect-timeout bound passed. */
  onUnreachable(): void;
}

/** Whether the text of a question is one terminal mode recognises. */
export function isTerminalPrompt(text: string): boolean {
  const lines = text.split('\n');
  const line = lines[lines.length - 1]?.trimEnd() ?? '';
  return (
    line.endsWith("'s password:") ||
    line.endsWith('Password:') ||
    line.endsWith('Verification code:') ||
    CONTINUE_QUESTION.test(line) ||
    PASSPHRASE_QUESTION.test(line)
  );
}

/** Reads a login terminal's plain-text output and tells when a recognised question waits. */
export class PromptReader {
  private readonly events: PromptReaderEvents;
  private readonly scheduler: Scheduler;
  private readonly timeoutMilliseconds: number;
  private readonly window: string[] = [];
  private readonly splitter = new LineSplitter(line => {
    this.completeLine(line);
  });
  private partial = '';
  private held = '';
  private inputOpen = false;
  private stopped = false;
  private handshake = false;
  private reportedPartial: string | undefined;
  private unreachableReported = false;
  private pauseCancel: (() => void) | undefined;
  private boundCancel: (() => void) | undefined;

  /** One reader on a login terminal's output. */
  constructor(
    scheduler: Scheduler,
    timeoutMilliseconds: number,
    events: PromptReaderEvents,
  ) {
    this.scheduler = scheduler;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.events = events;
  }

  /** The next plain-text piece of the terminal's output. */
  push(text: string): void {
    if (this.stopped) {
      return;
    }
    if (this.inputOpen) {
      this.held += text;
      return;
    }
    this.ingest(text);
  }

  /** The owner showed an input for the last question; output is held until `inputClosed`. */
  inputOpened(): void {
    if (this.stopped) {
      return;
    }
    this.inputOpen = true;
    this.boundCancel?.();
    this.boundCancel = undefined;
  }

  /** The input was answered or dismissed; held output is read now. */
  inputClosed(): void {
    if (this.stopped) {
      return;
    }
    this.inputOpen = false;
    if (this.held !== '') {
      const held = this.held;
      this.held = '';
      this.ingest(held);
    }
    if (this.handshake) {
      this.armBound();
    }
  }

  /** The attempt is over; nothing fires afterwards. */
  stop(): void {
    this.stopped = true;
    this.pauseCancel?.();
    this.pauseCancel = undefined;
    this.boundCancel?.();
    this.boundCancel = undefined;
  }

  /** One piece of output: its lines and its partial line, then the timers that follow them. */
  private ingest(text: string): void {
    const end = text.lastIndexOf('\n');
    if (end >= 0) {
      // A line end ends the reported question, so the same text later is a re-ask.
      this.reportedPartial = undefined;
    }
    this.partial = end < 0 ? this.partial + text : text.slice(end + 1);
    this.splitter.push(text);
    this.armPause();
    if (this.handshake) {
      this.armBound();
    }
  }

  private completeLine(line: string): void {
    this.window.push(line);
    if (this.window.length > LINE_WINDOW) {
      this.window.shift();
    }
    if (setupMarkerOf(line) === 'handshake') {
      this.handshake = true;
      this.armBound();
    }
  }

  /** The window and the partial line, what a question's text would be. */
  private candidate(): string {
    return [...this.window, this.partial].join('\n');
  }

  private armPause(): void {
    this.pauseCancel?.();
    this.pauseCancel = this.scheduler.setTimer(
      PARTIAL_LINE_PAUSE_MILLISECONDS,
      () => {
        this.pauseCancel = undefined;
        this.tryPartial();
      },
    );
  }

  private armBound(): void {
    this.boundCancel?.();
    this.boundCancel = this.scheduler.setTimer(this.timeoutMilliseconds, () => {
      this.boundCancel = undefined;
      this.tryBound();
    });
  }

  private tryPartial(): void {
    if (this.partial.trimEnd() === '') {
      return;
    }
    if (this.partial === this.reportedPartial) {
      return;
    }
    const candidate = this.candidate();
    if (!isTerminalPrompt(candidate)) {
      return;
    }
    this.reportedPartial = this.partial;
    // The reported prompt is held in the splitter; delivering it clears the window with it.
    this.splitter.flush();
    this.window.length = 0;
    this.events.onQuestion(candidate);
  }

  private tryBound(): void {
    if (this.unreachableReported || this.partial.trimEnd() === '') {
      return;
    }
    if (isTerminalPrompt(this.candidate())) {
      return;
    }
    this.unreachableReported = true;
    this.events.onUnreachable();
  }
}
