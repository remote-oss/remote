/**
 * @fileoverview The texts of the prompt surface: the English template of each string id the prompt classifier
 * names, and the one text shown while another window holds the login. The extension translates a template with the
 * editor's own localisation before the values are put in.
 */

import type {PromptStringId, PromptText} from 'lib-ssh';

/** The English template of each string id, with `{0}`, `{1}` for the values. */
const PROMPT_TEMPLATES: Readonly<Record<PromptStringId, string>> = {
  S001: '"{0}" has fingerprint "{1}".',
  S012: 'Are you sure you want to continue connecting?',
  S013: 'Are you sure you want to continue?',
  S015: 'Cancel',
  S028: 'Continue',
  S064: 'Enter passphrase for ssh key {0}',
  S065: 'Enter password',
  S066: 'Enter password for {0}',
};

/** What the window shows while another window holds the login. */
export const WAITING_TEMPLATE = 'Waiting for other windows to connect';

/** Puts the values into the `{n}` places of a template. */
function fillTemplate(template: string, values: readonly string[]): string {
  return values.reduce(
    (text, value, index) => text.replaceAll(`{${String(index)}}`, value),
    template,
  );
}

/** Turns a template into the text for the display language. */
export type Translate = (template: string) => string;

/** The text on a surface: a string of the table in the display language with its values, or text as it is. */
export function textOf(text: PromptText, translate: Translate): string {
  return 'text' in text
    ? text.text
    : fillTemplate(translate(PROMPT_TEMPLATES[text.id]), text.values);
}
