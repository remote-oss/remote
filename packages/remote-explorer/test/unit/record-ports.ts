/** The host of a record under test: the lines it was told to append, and a clock that stands still. */
export function recordPorts(): {
  lines: Array<[string, string]>;
  append: (file: string, line: string) => void;
  now: () => number;
} {
  const lines: Array<[string, string]> = [];
  return {
    lines,
    append: (file, line) => {
      lines.push([file, line]);
    },
    now: () => 1700000000000,
  };
}
