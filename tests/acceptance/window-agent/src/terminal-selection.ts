/** What reading a terminal's selection gave: the text, or that the selection cannot be read at all. */
export type SelectionRead =
  | {readonly kind: 'text'; readonly text: string}
  | {readonly kind: 'unreadable'};

/**
 * The selection of a terminal, through the proposed terminalSelection API, whose types are not part of this project.
 * A selection that is empty is the empty text; an editor that does not grant the proposal to the agent either has no
 * such property or refuses the read, and that is `unreadable`, never an empty selection.
 */
export function readSelection(terminal: object | undefined): SelectionRead {
  try {
    if (terminal === undefined || !('selection' in terminal)) {
      return {kind: 'unreadable'};
    }
    const selection = (terminal as {selection?: string}).selection;
    return {kind: 'text', text: selection ?? ''};
  } catch {
    return {kind: 'unreadable'};
  }
}
