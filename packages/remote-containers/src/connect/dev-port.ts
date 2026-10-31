/**
 * @fileoverview The port the configuration fixes for the server with `devPort`: a decision over
 * the merged configuration, in the form the server's port range setting takes.
 */

import {isRecord} from '../extensions/extension-list.ts';

/** The server's port range for a value: the one port as `port-port` for a positive integer, nothing for any other value. */
function rangeOf(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? `${String(value)}-${String(value)}`
    : undefined;
}

/**
 * The `portRange` of the server for the merged configuration: the `devPort` of the last `customizations.vscode`
 * layer that sets one, else the top-level `devPort`; a positive integer gives its one-port range (a value above 65535
 * included, which the server's start refuses as malformed), and zero, a fraction, text, null or anything else gives an empty range, a
 * dynamic port.
 */
export function devPortOf(
  mergedConfiguration: Record<string, unknown> | undefined,
): string {
  const customizations = mergedConfiguration?.customizations;
  const layers = isRecord(customizations) ? customizations.vscode : undefined;
  const withPort = (Array.isArray(layers) ? layers : []).filter(
    (layer): layer is Record<string, unknown> =>
      isRecord(layer) && 'devPort' in layer,
  );
  const last = withPort.at(-1);
  return (
    rangeOf(last === undefined ? mergedConfiguration?.devPort : last.devPort) ??
    ''
  );
}
