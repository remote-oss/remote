/**
 * @fileoverview The plain text input the commands ask, as the "Enter SSH Connection Command" one: the text typed, or
 * nothing when it is dismissed.
 */

/** What a text input is asked with. */
interface TextInputRequest {
  title?: string;
  prompt?: string;
  placeholder?: string;
}

/** A plain text input: the text typed, or nothing when it is dismissed. */
export interface TextInputPort {
  showInputBox(request: TextInputRequest): Promise<string | undefined>;
}
