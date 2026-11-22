/**
 * @fileoverview The merge of the viewport reads of a virtualized list's walk into the list's rows in order: a read at
 * the list's top first, then the reads of the downward walk; a row keeps the values of the read that first shows it,
 * and the direction a wheel of the list went is told by the labels the viewport showed before and after it.
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

/**
 * The direction a wheel of a virtualized list went, told by the labels the viewport showed before and after it:
 * 'down' when the new top stood below the old one in the list, 'up' when the new bottom stood above the old one,
 * and undefined when the labels do not tell. The sticky (pinned) rows are left out of the labels by the page,
 * since they do not move. Its own text is stringified into the page (the wheel to the list's top in
 * `renderer.ts`), so it must not name a helper of this module: the page runs it as plain JavaScript.
 */
export function wheelDirection(
  before: readonly string[],
  after: readonly string[],
): 'down' | 'up' | undefined {
  const first = after[0];
  const last = after.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  if (before.indexOf(first) > 0) {
    return 'down';
  }
  const index = before.indexOf(last);
  return index !== -1 && index < before.length - 1 ? 'up' : undefined;
}
