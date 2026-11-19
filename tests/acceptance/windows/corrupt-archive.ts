/**
 * The lines of a build's log that show SDKMAN's download came back corrupt and the install gave up on it: the download
 * lines it began, its verdict and the giving up, in order, or none when the log holds not both. A build that failed for another reason gives none, so
 * that only this third-party fault, which no product change can cause, is ever taken for a reason to build again.
 */
export function corruptArchiveLines(lines: readonly string[]): string[] {
  const corrupt = lines.some(line => line.includes('The archive was corrupt'));
  // The verdict alone is not the cause: SDKMAN retries inside the build, so a build that recovered from a corrupt archive
  // and failed for another reason holds it too. The cause is the verdict followed by the install giving up.
  const gaveUp = lines.some(line => /failed after \d+ attempts/.test(line));
  if (!corrupt || !gaveUp) {
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
