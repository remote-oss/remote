/**
 * @fileoverview What every host channel shares to keep the channel contract: the program piece that joins a script's
 * standard error to its standard output, the POSIX script that ends a cancelled script's whole process tree, and the
 * line splitter that bounds a pending line.
 */

/** The front of a POSIX shell's program that joins the script's standard error to its standard output, in order. */
export const JOINED_ERRORS = 'exec 2>&1; ';

/** The most characters a channel holds of a line with no line end yet, before it hands them on as a line. */
export const LONGEST_PENDING_LINE = 64 * 1024;

/**
 * A POSIX shell script that ends the process tree of the process `$1`: its descendants leaves first, then itself, TERM
 * first and KILL after 5 s, and it ends once they have gone, or 1 s after the KILL. It reads the tree from `ps -A -o pid= -o ppid=`, which procps, busybox and macOS share, so
 * it needs no job control. A process that left the tree by being re-parented is not in it, and is untouched.
 */
export const TREE_KILL_SCRIPT = [
  'root=$1',
  'table=$(ps -A -o pid= -o ppid=)',
  'descendants() {',
  '  for child in $(printf \'%s\\n\' "$table" | awk -v parent="$1" \'$2 == parent { print $1 }\'); do',
  '    descendants "$child"',
  '    printf \'%s\\n\' "$child"',
  '  done',
  '}',
  'members="$(descendants "$root") $root"',
  'kill -s TERM $members 2>/dev/null',
  'waited=0',
  'while [ "$waited" -lt 50 ]; do',
  '  alive=',
  '  for member in $members; do',
  '    kill -0 "$member" 2>/dev/null && alive=yes',
  '  done',
  '  [ -z "$alive" ] && exit 0',
  '  sleep 0.1',
  '  waited=$((waited + 1))',
  'done',
  'kill -s KILL $members 2>/dev/null',
  'waited=0',
  'while [ "$waited" -lt 10 ]; do',
  '  alive=',
  '  for member in $members; do',
  '    kill -0 "$member" 2>/dev/null && alive=yes',
  '  done',
  '  [ -z "$alive" ] && exit 0',
  '  sleep 0.1',
  '  waited=$((waited + 1))',
  'done',
  'exit 0',
].join('\n');

/** The lines of a stream of text, each told without its line end, and any line longer than `LONGEST_PENDING_LINE` told in parts of that length. */
export class BoundedLines {
  private pending = '';
  private readonly onLine: (line: string) => void;

  /** Lines told to `onLine`. */
  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  /** Takes the next piece of the stream, telling each line it completes and each full pending part. */
  push(piece: string): void {
    const text = this.pending + piece;
    const lastEnd = text.lastIndexOf('\n');
    for (const line of lastEnd < 0 ? [] : text.slice(0, lastEnd).split('\n')) {
      this.tell(line.replace(/\r$/u, ''));
    }
    let rest = text.slice(lastEnd + 1);
    while (rest.length > LONGEST_PENDING_LINE) {
      this.onLine(rest.slice(0, LONGEST_PENDING_LINE));
      rest = rest.slice(LONGEST_PENDING_LINE);
    }
    this.pending = rest;
  }

  /** Tells the last line, when the stream ended without a line end. */
  flush(): void {
    if (this.pending !== '') {
      this.tell(this.pending.replace(/\r$/u, ''));
      this.pending = '';
    }
  }

  /** Tells `line`, cut into parts of at most `LONGEST_PENDING_LINE` characters. */
  private tell(line: string): void {
    for (let start = 0; start < line.length; start += LONGEST_PENDING_LINE) {
      this.onLine(line.slice(start, start + LONGEST_PENDING_LINE));
    }
    if (line === '') {
      this.onLine('');
    }
  }
}
