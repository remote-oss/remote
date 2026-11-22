/**
 * @fileoverview The dialog the actions of the views ask the user to confirm.
 */

/** A modal dialog that is confirmed by one button. */
export interface Confirmation {
  /** The first line; empty for a dialog that has only a detail. */
  message: string;
  detail: string;
  /** The text of the button that confirms. */
  accept: string;
  /** `info` for the information icon; none for the warning icon. */
  severity?: 'info';
}
