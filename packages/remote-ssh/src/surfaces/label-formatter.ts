/**
 * @fileoverview What the window gets once its first resolve has settled with the connection up: the label, the
 * workspace suffix the editor shows after the workspace names, registered for the window's life and removed with the
 * window.
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
