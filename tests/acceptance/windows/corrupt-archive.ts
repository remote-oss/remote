/**
 * The lines of a build's log that show SDKMAN's download came back corrupt: the download lines it began and its
 * verdict, in order, or none when the log holds no such verdict. A build that failed for another reason gives none, so
 * that only this third-party fault, which no product change can cause, is ever taken for a reason to build again.
 */
export function corruptArchiveLines(lines: readonly string[]): string[] {
  if (!lines.some(line => line.includes('The archive was corrupt'))) {
    return [];
  }
  return lines
    .filter(line =>
      /Downloading: |The archive was corrupt|failed after \d+ attempts/.test(
        line,
      ),
    )
    .map(line => line.trim());
}
