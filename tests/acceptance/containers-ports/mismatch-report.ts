/** How many times the status text is read again after a mismatch, to say whether it was a moment or stayed. */
export const READ_AGAIN_SECONDS = 5;

/** How many Ports rows a report lists; the others are counted. */
export const REPORTED_ROWS = 10;

/** The columns of a Ports row that a report shows. */
export interface ReportedRow {
  port: string;
  forwardedAddress: string;
  origin: string;
}

/** What a read that failed shows in place of its value. */
function unreadable(caught: unknown): string {
  return `(unreadable: ${String(caught)})`;
}

/**
 * The text of a mismatch with what the window showed around it: the Ports rows read before it, as many as
 * `REPORTED_ROWS` and a count of the rest, and the status text over the next `READ_AGAIN_SECONDS`, one read a pause
 * apart. A read that fails shows as unreadable, so that the mismatch is never replaced by the failure of a read.
 */
export async function mismatchReport(
  mismatch: unknown,
  rows: readonly ReportedRow[],
  readStatus: () => Promise<string>,
  pause: () => Promise<void>,
): Promise<string> {
  const listed = rows
    .slice(0, REPORTED_ROWS)
    .map(each => [each.port, each.forwardedAddress, each.origin]);
  const more =
    rows.length > REPORTED_ROWS
      ? ` and ${String(rows.length - REPORTED_ROWS)} more`
      : '';
  const seen: string[] = [];
  for (let second = 0; second < READ_AGAIN_SECONDS; second += 1) {
    await pause();
    seen.push(await readStatus().catch(unreadable));
  }
  return `${String(mismatch)}\nthe Ports rows at the read: ${JSON.stringify(listed)}${more}\nthe status text over the next ${String(READ_AGAIN_SECONDS)} s: ${JSON.stringify(seen)}`;
}
