/**
 * @fileoverview The messages between the askpass program that `ssh` runs and the helper's askpass endpoint: the
 * program asks one question with the helper's askpass nonce and gets one answer; a closed connection is a refusal.
 */

/** What the program sends: the question `ssh` passed to it. */
export interface AskRequest {
  type: 'ask';
  nonce: string;
  text: string;
}

/** What the helper sends back: the text the user gave. */
export interface AskReply {
  type: 'answer';
  text: string;
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The request a value is, or undefined when it is none. */
export function readAskRequest(value: unknown): AskRequest | undefined {
  return isFields(value) &&
    value.type === 'ask' &&
    typeof value.nonce === 'string' &&
    typeof value.text === 'string'
    ? {type: 'ask', nonce: value.nonce, text: value.text}
    : undefined;
}

/** The reply a value is, or undefined when it is none. */
export function readAskReply(value: unknown): AskReply | undefined {
  return isFields(value) &&
    value.type === 'answer' &&
    typeof value.text === 'string'
    ? {type: 'answer', text: value.text}
    : undefined;
}
