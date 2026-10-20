/**
 * @fileoverview The port attributes a dev container configuration carries, as the two machine settings that core reads
 * them from.
 */

import {isRecord} from '../extensions/extension-list.ts';
import type {MachineSettings} from '../settings/machine-settings.ts';

/** The setting that holds the attributes of each declared port. */
const PORTS_SETTING = 'remote.portsAttributes';

/** The setting that holds the attributes of every other port. */
const OTHER_PORTS_SETTING = 'remote.otherPortsAttributes';

/** The `settings` of each `customizations.vscode` layer, in the merged order. */
function layerSettings(
  merged: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const customizations = merged.customizations;
  const layers = isRecord(customizations) ? customizations.vscode : undefined;
  if (!Array.isArray(layers)) {
    return [];
  }
  return layers.flatMap(layer =>
    isRecord(layer) && isRecord(layer.settings) ? [layer.settings] : [],
  );
}

/** The entries of `attributes` whose key does not start with a dash, which marks a port that is not forwarded. */
function forwardedEntries(
  attributes: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(attributes).filter(([key]) => !key.startsWith('-'));
}

/**
 * The machine settings for the merged configuration's port attributes: a port key a layer names replaces the
 * top-level entry for that key whole, and the last layer's `otherPortsAttributes` replaces the top-level one whole.
 */
export function portAttributeSettings(merged: unknown): MachineSettings {
  if (!isRecord(merged)) {
    return {};
  }
  const layers = layerSettings(merged);
  const named = [
    merged.portsAttributes,
    ...layers.map(layer => layer[PORTS_SETTING]),
  ].filter(isRecord);
  const others = [
    merged.otherPortsAttributes,
    ...layers.map(layer => layer[OTHER_PORTS_SETTING]),
  ].filter(isRecord);
  return {
    ...(named.length === 0
      ? {}
      : {
          [PORTS_SETTING]: Object.fromEntries(
            named.flatMap(attributes => forwardedEntries(attributes)),
          ),
        }),
    ...(others.length === 0 ? {} : {[OTHER_PORTS_SETTING]: others.at(-1)}),
  };
}
