/**
 * @fileoverview What the window gets once its host has reported its platform: the label, the workspace suffix the
 * editor shows after the workspace names, registered for the window's life and removed with the window. A connect that
 * fails before the host reported registers nothing, so the editor keeps no label for an authority that never got that
 * far.
 */

import {
  type DecodedTarget,
  type LabelFormatterHost,
  registerAuthorityLabel,
} from 'lib-authority';
import {workspaceSuffixOf} from '../window/label-suffix.ts';
import {ownText} from './own-strings.ts';
import type {Translate} from './strings.ts';

/** The connector's report that a connect's host reported its platform. */
export interface HostReports {
  onHostReported(listener: (target: DecodedTarget) => void): () => void;
}

/**
 * Registers the window's label the first time a connect's host reports its platform, once. Gives back what removes it,
 * which does nothing when nothing was registered.
 */
export function registerWindowLabel(
  reports: HostReports,
  formatter: LabelFormatterHost,
  translate: Translate,
): {dispose(): void} {
  let registration: {dispose(): void} | undefined;
  const stopHearing = reports.onHostReported(target => {
    if (registration !== undefined || !('kind' in target.target)) {
      return;
    }
    registration = registerAuthorityLabel(
      formatter,
      target,
      ownText(workspaceSuffixOf(target.target), translate),
    );
  });
  return {
    dispose: () => {
      stopHearing();
      registration?.dispose();
      registration = undefined;
    },
  };
}
