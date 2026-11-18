/**
 * @fileoverview The failure a wait for a connect throws: the wait's own failure first, then what the harness read to
 * explain it. Reading the explanation can fail too; that failure is told in its place and never takes the place of the
 * wait's own.
 */

/** A titled section of an explanation: its text, or why it could not be read. */
export function section(title: string, read: () => string): string {
  let text: string;
  try {
    text = read();
  } catch (caught) {
    text = `(unreadable: ${String(caught)})`;
  }
  return `${title}:\n${text}`;
}

/** A titled section of an explanation read in time: its text, or why it could not be read. */
export async function settledSection(
  title: string,
  read: () => Promise<string>,
): Promise<string> {
  let text: string;
  try {
    text = await read();
  } catch (caught) {
    text = `(unreadable: ${String(caught)})`;
  }
  return `${title}:\n${text}`;
}

/** The failure `caught`, with `explain`'s text after it, or, when `explain` fails, the line that says so. */
export async function explainedFailure(
  caught: unknown,
  explain: () => Promise<string>,
): Promise<Error> {
  let explanation: string;
  try {
    explanation = await explain();
  } catch (failed) {
    explanation = `(the explanation could not be read: ${String(failed)})`;
  }
  return new Error(`${String(caught)}\n${explanation}`, {cause: caught});
}
