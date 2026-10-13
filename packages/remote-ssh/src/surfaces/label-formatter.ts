/**
 * @fileoverview What the window gets once its first resolve has settled with the connection up: the label, the
 * workspace suffix the editor shows after the workspace names, registered for the window's life and removed with the
 * window, and core's Ports view, which core registers only when the window's context key says so.
 */

import {
  type LabelFormatterHost,
  type ResolverHandle,
  registerAuthorityLabel,
} from 'lib-authority';
import {
  shouldRegisterLabel,
  workspaceSuffixOf,
} from '../window/label-suffix.ts';
import type {Logger} from 'lib-log';
import {ownText} from './own-strings.ts';
import type {Translate} from './strings.ts';

/**
 * Registers the window's label once its first resolve has settled with the connection up. Gives back what removes it,
 * which does nothing when nothing was registered.
 */
export function registerWindowLabel(
  resolver: Pick<ResolverHandle, 'currentConnection' | 'onFirstResolveSettled'>,
  formatter: LabelFormatterHost,
  translate: Translate,
): {dispose(): void} {
  let registration: {dispose(): void} | undefined;
  let disposed = false;
  resolver.onFirstResolveSettled(() => {
    const connection = resolver.currentConnection();
    if (
      connection !== undefined &&
      shouldRegisterLabel(connection.state) &&
      'kind' in connection.decodedTarget.target
    ) {
      registration = registerAuthorityLabel(
        formatter,
        connection.decodedTarget,
        ownText(workspaceSuffixOf(connection.decodedTarget.target), translate),
      );
      if (disposed) {
        registration.dispose();
        registration = undefined;
      }
    }
  });
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      registration?.dispose();
      registration = undefined;
    },
  };
}

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
    if (connection !== undefined && shouldRegisterLabel(connection.state)) {
      void Promise.resolve(host.enablePortsView()).catch((caught: unknown) => {
        logger.warn(
          `the Ports view could not be enabled: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
    }
  });
}
