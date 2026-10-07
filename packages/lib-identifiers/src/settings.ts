/**
 * @fileoverview Reads a setting through the identifier table. A setting with a legacy twin takes the value of the
 * side that wins when both hold one; the other side counts only when the winner holds none.
 */

/** A setting of a package's identifier table. */
export interface SettingEntry {
  readonly id: string;
  /** Where the setting may be set, as the manifest declares it. */
  readonly scope: string;
  /** The older key that still takes effect when set. */
  readonly legacyId?: string;
  readonly legacyScope?: string;
  /** The side whose value counts when both keys hold one. */
  readonly winner?: 'current' | 'legacy';
}

/** The values one key holds at each level, as the editor reports them; an unset level is absent. */
export interface SettingInspection {
  readonly defaultValue?: unknown;
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

/** The editor operation that reading a setting needs. */
export interface SettingHost {
  /** The values `settingId` holds at each level. */
  inspectSetting(settingId: string): SettingInspection;
}

/** The scopes whose settings the editor also takes from the workspace; the others only from the user. */
const WORKSPACE_SCOPES = new Set([
  'window',
  'resource',
  'language-overridable',
  'machine-overridable',
]);

/** The value a key holds at the most specific level that applies to its scope, or undefined when it holds none. */
function heldValue(inspection: SettingInspection, scope: string): unknown {
  const levels = WORKSPACE_SCOPES.has(scope)
    ? [
        inspection.workspaceFolderValue,
        inspection.workspaceValue,
        inspection.globalValue,
      ]
    : [inspection.globalValue];
  return levels.find(value => value !== undefined);
}

/** An empty or null legacy value of a pair whose legacy side wins does not count as held. */
function heldLegacyValue(entry: SettingEntry, value: unknown): unknown {
  return entry.winner === 'legacy' && (value === '' || value === null)
    ? undefined
    : value;
}

/**
 * The effective value of a setting: the winning side's value when both keys hold one, the other side's when only
 * it does, and the current key's declared default when neither does.
 */
export function readSetting(host: SettingHost, entry: SettingEntry): unknown {
  const inspection = host.inspectSetting(entry.id);
  const current = heldValue(inspection, entry.scope);
  const legacy =
    entry.legacyId === undefined
      ? undefined
      : heldLegacyValue(
          entry,
          heldValue(
            host.inspectSetting(entry.legacyId),
            entry.legacyScope ?? 'window',
          ),
        );
  const ranked =
    entry.winner === 'legacy' ? [legacy, current] : [current, legacy];
  for (const value of ranked) {
    if (value !== undefined) {
      return value;
    }
  }
  return inspection.defaultValue;
}
