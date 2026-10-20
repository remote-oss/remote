/**
 * @fileoverview The effective `shutdownAction` of a container: the value recorded on it when it was made, or the
 * configuration file's when it carries no metadata. Only the two stop values of the schema stop; the other
 * non-empty values mean none, and an absent or empty one means the kind's default, which is a stop for an image or a
 * Dockerfile.
 */

/** What the helper does when the last connection to the container ends. */
export type ShutdownAction = 'stop' | 'none';

/** The two values of the schema that stop, each on either kind of configuration. */
const STOP_VALUES: ReadonlySet<unknown> = new Set([
  'stopContainer',
  'stopCompose',
]);

/** The values that count as an absent key. */
const ABSENT_VALUES: ReadonlySet<unknown> = new Set([
  undefined,
  null,
  false,
  0,
  '',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a `shutdownAction` value means for an image or Dockerfile configuration. */
function actionOf(value: unknown): ShutdownAction {
  if (ABSENT_VALUES.has(value) || STOP_VALUES.has(value)) {
    return 'stop';
  }
  return 'none';
}

/**
 * The value recorded on the container, or the file's when the container has no metadata label. `recorded` is the
 * container's `devcontainer.metadata` entries in order, or undefined when it has no such label. The last entry that
 * has a `shutdownAction` key gives the value; a label whose entries have none gives the default, whatever the file says.
 */
export function effectiveAction(
  recorded: readonly unknown[] | undefined,
  fileValue: unknown,
): ShutdownAction {
  if (recorded === undefined) {
    return actionOf(fileValue);
  }
  const keyed = recorded.filter(
    entry => isRecord(entry) && 'shutdownAction' in entry,
  );
  const last = keyed.at(-1);
  return actionOf(isRecord(last) ? last.shutdownAction : undefined);
}
