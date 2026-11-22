/**
 * @fileoverview The merge of the viewport reads of a virtualized list's walk into the list's rows in order: a read at
 * the list's top first, then the reads of the downward walk; a row keeps the values of the read that first shows it.
 */

/** A row as one viewport read of a virtualized list shows it; `expanded` is null when the read did not draw the state. */
export interface ViewRowRead {
  label: string;
  description: string;
  level: number;
  expanded: boolean | null;
}

/**
 * The rows a sequence of viewport reads of a virtualized list shows, in the list's order. The reads come from a walk
 * that starts at the list's top and moves down; a row the reads show twice, as the list pins a header the walk
 * passes, keeps the values of the read that first shows it.
 */
export function mergeReads(
  reads: ReadonlyArray<readonly ViewRowRead[]>,
): ViewRowRead[] {
  const seen = new Map<string, ViewRowRead>();
  const order: ViewRowRead[] = [];
  for (const read of reads) {
    for (const each of read) {
      const key = `${String(each.level)}:${each.label}`;
      if (!seen.has(key)) {
        seen.set(key, each);
        order.push(each);
      }
    }
  }
  return order;
}
