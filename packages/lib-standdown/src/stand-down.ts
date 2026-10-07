/**
 * @fileoverview The first step of every activation: when the extension a package stands down for runs in the same
 * window, the package registers nothing and shows one warning instead.
 */

/** What the guard decided: register nothing (`standing`) or go on with activation (`serving`). */
export type StandDownOutcome = 'standing' | 'serving';

/** The editor operations the guard needs. */
export interface StandDownHost {
  /** Whether the extension with this id runs in the extension's own host; a disabled extension does not. */
  isRunning(extensionId: string): boolean;
  /** Sets the context key `contextKey` to `value` in the window. */
  setContext(contextKey: string, value: boolean): PromiseLike<unknown>;
  /** Shows a warning with one button and resolves to the button's label when the user chose it. */
  showWarning(text: string, button: string): PromiseLike<string | undefined>;
  /** Opens the Extensions view on the extension with this id. */
  revealExtension(extensionId: string): PromiseLike<unknown>;
}

/** What a package passes to the guard. */
export interface StandDownRequest {
  /** The id of the extension the package stands down for. */
  readonly standsDownFor: string;
  /** The context key that hides the package's menu entries while it stands down; empty or absent when none. */
  readonly standingDownKey?: string;
  /** The warning text, in the user's language. */
  readonly warning: string;
  /** The label of the warning's one button, in the user's language. */
  readonly button: string;
}

/**
 * Looks the other extension up and, when it runs, sets the standing-down key, shows the warning without waiting
 * for it, and resolves to `standing`. Otherwise it clears a key an earlier run in the same window left set and
 * resolves to `serving`. The caller registers nothing before this resolves, and nothing at all on `standing`.
 */
export async function standDownIfPresent(
  host: StandDownHost,
  request: StandDownRequest,
): Promise<StandDownOutcome> {
  const standing = host.isRunning(request.standsDownFor);
  const standingDownKey = request.standingDownKey ?? '';
  if (standingDownKey !== '') {
    await host.setContext(standingDownKey, standing);
  }
  if (!standing) {
    return 'serving';
  }
  void host
    .showWarning(request.warning, request.button)
    .then(choice =>
      choice === request.button
        ? host.revealExtension(request.standsDownFor)
        : undefined,
    );
  return 'standing';
}
