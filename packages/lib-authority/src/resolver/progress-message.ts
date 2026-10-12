/**
 * @fileoverview The message of a connect's progress: the stage's text, with the link to the details in front of the
 * first stage only.
 */

/** `text`, after the "(details)" link that runs `command` when `withLink` is set; the word is not translated. */
export function phaseMessage(
  text: string,
  withLink: boolean,
  command: string,
): string {
  return withLink ? `([details](command:${command})) ${text}` : text;
}
