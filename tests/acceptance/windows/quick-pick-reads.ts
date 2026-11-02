/**
 * @fileoverview The whole quick pick out of its on-screen reads: the rows of a virtualized list as each read saw them,
 * combined into the full set. It imports nothing from the harness or the editor, so that the tools project can test it.
 */

/** What a row of a quick pick shows. */
export interface QuickPickRowFields {
  label: string;
  description: string;
  /** The second line of the row; empty when the line is hidden. */
  detail: string;
  /** The codicon classes the row carries, such as `codicon-verified`. */
  icons: string[];
  buttons: string[];
  focused: boolean;
}

/** A row of a quick pick in one of its on-screen reads, tagged with its place in the full set. */
export interface QuickPickReadRow extends QuickPickRowFields {
  /** The row's 1-based place in the full set, from its `aria-posinset`. */
  position: number;
  /** The size of the full set, from its `aria-setsize`. */
  setSize: number;
}

/** One on-screen read of a quick pick: the rows it rendered, and the size of the full set they belong to. */
export interface QuickPickRead {
  rows: QuickPickReadRow[];
  setSize: number;
}

/**
 * The whole quick pick out of its on-screen reads: the union of the reads' rows, in list order by the rows'
 * `aria-posinset`; a read that missed rows fails against the set's `aria-setsize` instead of passing short.
 */
export function combineQuickPickReads(
  reads: readonly QuickPickRead[],
): QuickPickRowFields[] {
  const setSize = reads[0]?.setSize ?? 0;
  if (!Number.isInteger(setSize)) {
    throw new Error(`the quick pick's set has no size: ${String(setSize)}`);
  }
  const seen = new Map<number, QuickPickRowFields>();
  for (const read of reads) {
    if (read.setSize !== setSize) {
      throw new Error(
        `the quick pick's set changed mid-read: ${String(setSize)} rows, then ${String(read.setSize)}`,
      );
    }
    for (const entry of read.rows) {
      if (
        !Number.isInteger(entry.position) ||
        entry.position < 1 ||
        entry.position > setSize
      ) {
        throw new Error(
          `a quick pick row is out of its set: position ${String(entry.position)} of ${String(setSize)}`,
        );
      }
      seen.set(entry.position, {
        label: entry.label,
        description: entry.description,
        detail: entry.detail,
        icons: entry.icons,
        buttons: entry.buttons,
        focused: entry.focused,
      });
    }
  }
  if (seen.size !== setSize) {
    throw new Error(
      `the quick pick's reads missed rows: ${String(seen.size)} of ${String(setSize)}`,
    );
  }
  return [...seen.entries()]
    .sort((first, second) => first[0] - second[0])
    .map(([, entry]) => entry);
}
