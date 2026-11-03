/**
 * @fileoverview The dialogs the first check shows before the window reloads: their texts, their buttons and where each
 * button goes. A button opens its destination directly.
 */

import type {FirstCheckOutcome} from '../engine/check-outcome.ts';
import type {ComposeRoute} from '../engine/compose-route.ts';

/** Turns an English template into the text for the display language. */
export type Translate = (template: string) => string;

/** Where the buttons of the dialogs go. */
export const ENGINE_LINKS = {
  install: 'https://docs.docker.com/engine/install/',
  licence:
    'https://www.docker.com/legal/docker-subscription-service-agreement/',
  permission: 'https://docs.docker.com/engine/install/linux-postinstall/',
  compose: 'https://docs.docker.com/compose/install/',
} as const;

/** The English template of each text of the dialogs, by its string id. */
export const ENGINE_TEMPLATES = {
  S061: 'Check the license for details.',
  S079: "Command not found: '{0}'.",
  S103: "Current user does not have permission to run 'docker'.",
  S134: 'Docker Compose required',
  S135: 'Docker Compose returned an error.',
  S143: 'Docker returned an error.',
  S146: 'Docker version 17.12.0 or later required.',
  S147: 'Documentation',
  S201: 'Ignore',
  S204: 'Install',
  S221: 'License',
  S226: 'Make sure the Docker daemon is running.',
  S324: 'Show Log',
  S380: "Try adding the user to the 'docker' group.",
} as const;

/** What a button does when it is chosen. */
export type EngineButtonAction =
  | 'openInstall'
  | 'openLicence'
  | 'openPermission'
  | 'openCompose'
  | 'ignore'
  | 'showLog';

/** One button: its text, and what choosing it does. */
export interface EngineButton {
  label: string;
  action: EngineButtonAction;
}

/** A modal error dialog: its message, its detail and its buttons, the primary one first. */
export interface EngineDialog {
  message: string;
  detail: string;
  buttons: readonly EngineButton[];
}

/** The destination of a button that opens an address. */
export const BUTTON_LINKS: Readonly<
  Record<Exclude<EngineButtonAction, 'ignore' | 'showLog'>, string>
> = {
  openInstall: ENGINE_LINKS.install,
  openLicence: ENGINE_LINKS.licence,
  openPermission: ENGINE_LINKS.permission,
  openCompose: ENGINE_LINKS.compose,
};

/** The dialog for an outcome other than `passed`; `written` is the value of `dockerPath` as written. */
export function dialogOf(
  outcome: Exclude<FirstCheckOutcome, 'passed'>,
  written: string,
  translate: Translate,
): EngineDialog {
  function text(templateId: keyof typeof ENGINE_TEMPLATES): string {
    return translate(ENGINE_TEMPLATES[templateId]);
  }
  const install: EngineButton = {label: text('S204'), action: 'openInstall'};
  const licence: EngineButton = {label: text('S221'), action: 'openLicence'};
  const licenceDetail = text('S061');
  if (outcome === 'permission') {
    return {
      message: text('S103'),
      detail: text('S380'),
      buttons: [{label: text('S147'), action: 'openPermission'}],
    };
  }
  if (outcome === 'engineError') {
    return {
      message: text('S143'),
      detail: text('S226'),
      buttons: [{label: text('S324'), action: 'showLog'}],
    };
  }
  if (outcome === 'tooOld') {
    return {
      message: text('S146'),
      detail: licenceDetail,
      buttons: [install, licence, {label: text('S201'), action: 'ignore'}],
    };
  }
  return {
    message: text('S146'),
    detail:
      written === 'docker'
        ? licenceDetail
        : `${text('S079').replace('{0}', written)} ${licenceDetail}`,
    buttons: [install, licence],
  };
}

/**
 * The dialog for a Compose that cannot be used. The default program missing is the single line S134; any other program
 * missing adds S079 with the value as written. A program that exists but cannot run gives S135 alone.
 */
export function composeDialogOf(
  route: Extract<ComposeRoute, {kind: 'missing' | 'broken'}>,
  translate: Translate,
): EngineDialog {
  function text(templateId: keyof typeof ENGINE_TEMPLATES): string {
    return translate(ENGINE_TEMPLATES[templateId]);
  }
  if (route.kind === 'broken') {
    return {
      message: '',
      detail: text('S135'),
      buttons: [{label: text('S324'), action: 'showLog'}],
    };
  }
  return {
    message: text('S134'),
    detail: route.byDefault ? '' : text('S079').replace('{0}', route.written),
    buttons: [{label: text('S147'), action: 'openCompose'}],
  };
}
