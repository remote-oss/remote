/**
 * @fileoverview Recognises the questions `ssh` asks through its askpass channel and chooses how each is shown:
 * a pick for the host-key questions it knows, a masked input for everything else. The first rule that matches wins.
 */

import type {BehaviourChoices} from '../choices.ts';
import {BEHAVIOUR_CHOICES} from '../choices.ts';

/** The string ids a prompt surface uses. */
export type PromptStringId =
  'S001' | 'S012' | 'S013' | 'S015' | 'S028' | 'S064' | 'S065' | 'S066';

/** Text on a surface: a string of the table with its placeholder values, or text shown as it is. */
export type PromptText =
  {id: PromptStringId; values: string[]} | {text: string};

/** One item of a pick and what choosing it answers. */
export interface PickItem {
  label: PromptText;
  answer: 'yes' | 'no';
}

/**
 * How a question is shown. A pick answers with its item's answer; a masked input answers with the typed text
 * unchanged. Cancelling either refuses the question.
 */
export type PromptSurface =
  | {
      surface: 'fingerprintPick' | 'continuationPick';
      title: PromptText;
      placeholder: PromptText;
      items: PickItem[];
    }
  | {surface: 'maskedInput'; placeholder: PromptText};

/** The placeholder for one-time codes, kept in English in every display language. */
const VERIFICATION_CODE_PLACEHOLDER = 'Enter verification code';

/** The question line that closes a host-key question, with any choice list in parentheses. */
const CONTINUE_QUESTION =
  /^Are you sure you want to continue connecting( \(.*\))?\?$/;

/** The classic fingerprint line: type, the words, one space, the fingerprint and a final full stop. */
const CLASSIC_FINGERPRINT = /^\S+ key fingerprint is (\S+)\.$/;

/** The newer fingerprint line, with a colon and without the final full stop. */
const COLON_FINGERPRINT = /^\S+ key fingerprint is: (\S+?)\.?$/;

/** The two lines of an address key that differs from the host key. */
const OFFENDING_LINE = /^Offending key for IP in .+:\d+$/;
const MATCHING_LINE = /^Matching host key in .+:\d+$/;

/** The passphrase question for a private key. */
const PASSPHRASE_QUESTION = /Enter passphrase for key '(.*)':/;

/** The password-method question, with the word before it. */
const PASSWORD_FOR = "'s password:";

/** The fixed items of both picks. */
const PICK_ITEMS: readonly PickItem[] = [
  {label: {id: 'S028', values: []}, answer: 'yes'},
  {label: {id: 'S015', values: []}, answer: 'no'},
];

/** Chooses the surface for a question `ssh` asks; the display host is the host as the user named it. */
export function classifyPrompt(
  text: string,
  displayHost: string,
  choices: BehaviourChoices = BEHAVIOUR_CHOICES,
): PromptSurface {
  const lines = text.split('\n').map(line => line.trimEnd());
  const questionLine = lines.findIndex(line => CONTINUE_QUESTION.test(line));
  if (questionLine >= 0) {
    const before = lines.slice(0, questionLine);
    const fingerprint = fingerprintOf(before, choices);
    if (fingerprint !== undefined) {
      return {
        surface: 'fingerprintPick',
        title: {id: 'S001', values: [displayHost, fingerprint]},
        placeholder: {id: 'S013', values: []},
        items: [...PICK_ITEMS],
      };
    }
    if (
      before.some(line => OFFENDING_LINE.test(line)) &&
      before.some(line => MATCHING_LINE.test(line))
    ) {
      return {
        surface: 'continuationPick',
        title: {text: before.join('\n').trim()},
        placeholder: {id: 'S012', values: []},
        items: [...PICK_ITEMS],
      };
    }
  }
  return {
    surface: 'maskedInput',
    placeholder: maskedPlaceholder(text, choices),
  };
}

/** The fingerprint of the host-key line before the question, in the forms the choices accept. */
function fingerprintOf(
  linesBeforeQuestion: string[],
  choices: BehaviourChoices,
): string | undefined {
  for (const line of linesBeforeQuestion) {
    const classic = CLASSIC_FINGERPRINT.exec(line);
    if (classic !== null) {
      return classic[1];
    }
    const colon = choices.fingerprintPickForColonForm
      ? COLON_FINGERPRINT.exec(line)
      : null;
    if (colon !== null) {
      return colon[1];
    }
  }
  return undefined;
}

/** The placeholder of a masked input: passphrase, password, code, or the question itself. */
function maskedPlaceholder(
  text: string,
  choices: BehaviourChoices,
): PromptText {
  const passphrase = PASSPHRASE_QUESTION.exec(text);
  if (passphrase !== null) {
    const keyFile = choices.passphraseNamesKeyFile ? (passphrase[1] ?? '') : '';
    return {id: 'S064', values: [keyFile]};
  }
  const passwordAt = text.indexOf(PASSWORD_FOR);
  if (passwordAt >= 0) {
    const words = text.slice(0, passwordAt).split(/\s+/);
    return {id: 'S066', values: [words[words.length - 1] ?? '']};
  }
  if (text.includes('Password:')) {
    return {id: 'S065', values: []};
  }
  if (text.includes('Verification code:')) {
    return {text: VERIFICATION_CODE_PLACEHOLDER};
  }
  return {text: text.startsWith(' ') ? text : ` ${text}`};
}
