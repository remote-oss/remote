/**
 * @fileoverview What the window gets once its first resolve starts: the label, the
 * workspace suffix the editor shows after the workspace names, registered for the window's life and removed with the
 * window.
 */

import {
  type LabelFormatterHost,
  type ResolverHandle,
  registerAuthorityLabel,
} from 'lib-authority';
import {workspaceSuffixOf} from '../window/label-suffix.ts';
import {ownText} from './own-strings.ts';
import type {Translate} from './strings.ts';

/**
 * Registers the window's label once its first resolve starts, before its outcome. Gives back what removes it,
 * which does nothing when nothing was registered.
 */
export function registerWindowLabel(
  resolver: Pick<ResolverHandle, 'onFirstResolveStarted'>,
  formatter: LabelFormatterHost,
  translate: Translate,
): {dispose(): void} {
  let registration: {dispose(): void} | undefined;
  let disposed = false;
  resolver.onFirstResolveStarted(target => {
    if ('kind' in target.target) {
      registration = registerAuthorityLabel(
        formatter,
        target,
        ownText(workspaceSuffixOf(target.target), translate),
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
