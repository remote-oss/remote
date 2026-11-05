/**
 * @fileoverview What the failure dialogs share: showing a modal error and finding the button chosen, and showing a quick
 * pick and finding the item chosen.
 */

/** One button of the modal error: its label, and whether Escape chooses it. */
export interface ErrorButton {
  title: string;
  isCloseAffordance?: boolean;
}

/**
 * Shows the modal error with `buttons` and gives the one chosen; More Actions... is the close affordance, so Escape
 * chooses it, and the editor gives its label back.
 */
export async function chosenButton<
  Button extends {label: string; action: string},
>(
  ports: {
    showError(
      message: string,
      detail: string,
      buttons: readonly ErrorButton[],
    ): PromiseLike<string | undefined>;
  },
  message: string,
  detail: string,
  buttons: readonly Button[],
): Promise<Button | undefined> {
  const chosen = await ports.showError(
    message,
    detail,
    buttons.map(button => ({
      title: button.label,
      ...(button.action === 'moreActions' ? {isCloseAffordance: true} : {}),
    })),
  );
  return buttons.find(each => each.label === chosen);
}

/** Shows the quick pick and gives the item chosen. */
export async function pickedItem<Item extends {label: string}>(
  ports: {
    pick(
      placeholder: string,
      labels: readonly string[],
    ): PromiseLike<string | undefined>;
  },
  pick: {placeholder: string; items: readonly Item[]},
): Promise<Item | undefined> {
  const chosen = await ports.pick(
    pick.placeholder,
    pick.items.map(item => item.label),
  );
  return pick.items.find(each => each.label === chosen);
}
