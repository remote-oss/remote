/**
 * @fileoverview What the editor command-line program's `serverlog` lines mean for the install progress: the line
 * that starts it, the percentage, and the lines after which it stays at 100 %.
 */

/** What a `serverlog` line changes in the install progress. */
export type S045Event =
  {kind: 'show'} | {kind: 'percent'; value: number} | {kind: 'hold'};

const DOWNLOAD_START = /^Downloading .+ server -> /;
const DOWNLOAD_PERCENT = /^server download progress: \d+\/\d+ \((\d+)%\)/;
const HOLD_LINES: readonly RegExp[] = [
  /^server inflate progress: /,
  /^Server integrity verified/,
  /^Server setup complete/,
  /^Starting server\.\.\./,
];

/** The event of one `serverlog` line, or nothing for a line that changes nothing. */
export function s045EventOf(line: {
  text: string;
  level: number;
}): S045Event | undefined {
  const {text} = line;
  if (DOWNLOAD_START.test(text)) {
    return {kind: 'show'};
  }
  const percent = DOWNLOAD_PERCENT.exec(text)?.[1];
  if (percent !== undefined) {
    return {kind: 'percent', value: Number(percent)};
  }
  return HOLD_LINES.some(pattern => pattern.test(text))
    ? {kind: 'hold'}
    : undefined;
}
