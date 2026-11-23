/**
 * @fileoverview What the text of a question that ssh or git asks through the askpass program says of its kind.
 */

/** The words of ssh's question about a host key it doesn't know yet. */
const HOST_KEY = 'Are you sure you want to continue connecting';

/** Whether `text` is ssh's question about a host key it doesn't know yet. */
export function isHostKeyQuestion(text: string): boolean {
  return text.includes(HOST_KEY);
}
