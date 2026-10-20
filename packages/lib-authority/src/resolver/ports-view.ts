/**
 * @fileoverview What a window does once its first resolve has settled with the connection up: it enables core's Ports
 * view under the window's context key. Nothing sets the key back: core drops a window's context keys with the window,
 * and a reconnection keeps the view.
 */

import type {Logger} from 'lib-log';
import type {ResolverHandle} from './host.ts';

/**
 * The window context key under which core registers its Ports view: `forwardedPortsViewEnabled`
 * ([oss] `src/vs/workbench/contrib/remote/browser/remoteExplorer.ts`). A window with a resolver sets it, as the
 * editor's own test resolver does ([oss] `extensions/vscode-test-resolver/src/extension.ts`).
 */
export const PORTS_VIEW_KEY = 'forwardedPortsViewEnabled';

/** What the editor does to enable core's Ports view in this window. */
export interface PortsViewHost {
  enablePortsView(): PromiseLike<unknown>;
}

/**
 * Enables core's Ports view once the window's first resolve has settled with the connection up, on the same condition
 * as the label. Nothing sets the key back: core drops a window's context keys with the window, and a reconnection
 * keeps the view. A refusal of the editor is logged and changes nothing else.
 */
export function enablePortsViewWhenConnected(
  resolver: Pick<ResolverHandle, 'currentConnection' | 'onFirstResolveSettled'>,
  host: PortsViewHost,
  logger: Pick<Logger, 'warn'>,
): void {
  resolver.onFirstResolveSettled(() => {
    const connection = resolver.currentConnection();
    if (connection?.state === 'connected') {
      void Promise.resolve(host.enablePortsView()).catch((caught: unknown) => {
        logger.warn(
          `the Ports view could not be enabled: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
    }
  });
}
