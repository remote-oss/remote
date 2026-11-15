/**
 * @fileoverview The standard output lines of a `LocalCommand` as the connection helper's log gets them: ssh runs the
 * command after authentication and before it opens the session, so the lines that come on the helper's `ssh` standard
 * output before its first protocol line are the command's. They are logged and nothing is decided from them.
 */

/** The most lines of a command's output the log keeps. */
const LOCAL_COMMAND_LINE_LIMIT = 100;

/** The most bytes of a command's output the log keeps. */
export const LOCAL_COMMAND_BYTE_LIMIT = 8 * 1024;

/** The one line that tells the output was cut. */
export const LOCAL_COMMAND_DROPPED_LINE = `more than ${String(LOCAL_COMMAND_LINE_LIMIT)} lines or ${String(LOCAL_COMMAND_BYTE_LIMIT / 1024)} KiB of the command's output were dropped`;

/** Counts a command's output lines against the limits. */
export class LocalCommandLog {
  private lines = 0;
  private bytes = 0;
  private dropped = false;

  /**
   * The line to log for the output line `line`: the line itself while the limits hold, the one dropped line when they
   * first do not, and nothing after that. A blank line is not output worth a log line and is not counted.
   */
  hear(line: string): string | undefined {
    if (this.dropped || line.trim() === '') {
      return undefined;
    }
    const size = new TextEncoder().encode(line).length;
    if (
      this.lines + 1 > LOCAL_COMMAND_LINE_LIMIT ||
      this.bytes + size > LOCAL_COMMAND_BYTE_LIMIT
    ) {
      this.dropped = true;
      return LOCAL_COMMAND_DROPPED_LINE;
    }
    this.lines += 1;
    this.bytes += size;
    return line;
  }
}
