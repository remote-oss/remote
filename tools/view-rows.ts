/**
 * @fileoverview The merge of the viewport reads of a virtualized list's walk into the list's rows in order: a read at
 * the list's top first, then the reads of the downward walk; a row keeps the values of the read that first shows it,
 * and the direction a wheel of the list went is told by the labels the viewport showed before and after it; the
 * probe of the wheel that stands the list at its top settles the sign on the direction its reads told, and a list
 * that is still filling its rows stands unsettled, for the walk to read it where it stands, and the labels
 * of the rows it then tells on stderr stand at 20, each cut at 80 characters, the left-out ones named as more.
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

/** How many labels, and how long a label, a walk that stands where it stands tells on stderr. */
const TOLD_ROWS = 20;
const TOLD_LABEL_LENGTH = 80;

/** `label` cut to `length` characters, with an ellipsis where it was cut. */
function cutTo(label: string, length: number): string {
  return label.length <= length ? label : `${label.slice(0, length)}…`;
}

/**
 * The labels of the rows a walk that could not reach its list's top tells on stderr: the first 20, each cut at
 * 80 characters, and the left-out ones named as more, so a list that keeps filling its rows ends the read with
 * a row of labels one can read.
 */
export function shownLabels(labels: readonly string[]): string {
  const told = labels
    .slice(0, TOLD_ROWS)
    .map(label => cutTo(label, TOLD_LABEL_LENGTH));
  const left = labels.length - told.length;
  return left > 0
    ? `${told.join(', ')} and ${String(left)} more`
    : told.join(', ');
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

/**
 * A read of a virtualized list's wheel probe: the wheel's delta, whether it moved the list, and the labels the
 * viewport showed before and after it.
 */
export interface WheelProbeRead {
  delta: number;
  moved: boolean;
  before: readonly string[];
  after: readonly string[];
}

/**
 * The verdict of the probe of the wheel to the list's top: whether its direction settled, the sign that stands the
 * list at its top, and the reads that counted toward the direction.
 */
export interface WheelTop {
  /** Whether the probe settled the list's wheel direction. */
  settled: boolean;
  /** The sign that scrolls the list up, 0 at its top. */
  sign: number;
  /** The reads that counted toward the direction, in all. */
  reads: number;
}

/**
 * The probe of the wheel that stands a virtualized list at its top: the sign that scrolls the list up varies with
 * the build, so a probe moves the list once at a sign, and at a boundary only one sign moves; the moved probe's
 * direction, told by `wheelDirection`, settles the sign — the opposite of the probe's delta when the probe stood
 * the list further down, the delta itself when it stood the list further up — and a probe that moved nothing means
 * the list already stands at its top, whose sign is zero. A list that is still filling its rows tells no direction
 * from one read, so the probe wheels the list again and reads it, up to three reads in all, and stands unsettled
 * when the direction still cannot be told: the walk then reads the list where it stands. Its own text and
 * `wheelDirection`'s are stringified into the page (the wheel to the list's top in `renderer.ts`), so the page
 * binds both, and it must not name any other helper of this module: the page runs it as plain JavaScript.
 */
export async function wheelTopProbe(
  probe: (delta: number) => Promise<WheelProbeRead>,
): Promise<WheelTop> {
  let topStep = await probe(-400);
  if (!topStep.moved) {
    topStep = await probe(400);
  }
  if (!topStep.moved) {
    return {settled: true, sign: 0, reads: 1};
  }
  let reads = 1;
  let direction = wheelDirection(topStep.before, topStep.after);
  while (direction === undefined && reads < 3) {
    reads += 1;
    topStep = await probe(topStep.delta);
    direction = wheelDirection(topStep.before, topStep.after);
  }
  if (direction === 'down') {
    return {settled: true, sign: -topStep.delta, reads};
  }
  if (direction === 'up') {
    return {settled: true, sign: topStep.delta, reads};
  }
  return {settled: false, sign: 0, reads};
}
