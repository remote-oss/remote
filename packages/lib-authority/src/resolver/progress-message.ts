/**
 * @fileoverview The message of a connect's progress: the stage's text, with the link to the details in front of the
 * stages that carry it.
 */

/**
 * `text`, after the "(details)" link that runs `command` when `withLink` is set; the word is not translated. The link
 * has `title` for its tooltip when one is given.
 */
export function phaseMessage(
  text: string,
  withLink: boolean,
  command: string,
  title?: string,
): string {
  if (!withLink) {
    return text;
  }
  const target =
    title === undefined
      ? command
      : `${command} "${title.replaceAll('"', '\\"')}"`;
  return `([details](command:${target})) ${text}`;
}
