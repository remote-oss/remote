/**
 * @fileoverview The non-modal notices the commands show: an information, warning or error message with buttons,
 * answering the button taken, or nothing when the notice is dismissed.
 */

/** A non-modal notice: the button taken, or nothing when it is dismissed. */
export interface NoticePort {
  showInformation(
    message: string,
    buttons: readonly string[],
  ): Promise<string | undefined>;
  showWarning(
    message: string,
    buttons: readonly string[],
  ): Promise<string | undefined>;
  showError(
    message: string,
    buttons: readonly string[],
  ): Promise<string | undefined>;
}
