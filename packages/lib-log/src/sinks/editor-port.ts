/**
 * The editor side a log sink reaches: an output channel that appends lines, and a terminal that
 * streams them. The consuming package implements this over `vscode`; the library never imports
 * it.
 */
export interface EditorLogPort {
  createOutputChannel(name: string): {
    appendLine(text: string): void;
    dispose(): void;
  };
  createTerminalWriter(name: string): TerminalWriter;
}

/** A terminal the editor gives a log: text written to it, its reveal, and when it opens and closes. */
export interface TerminalWriter {
  write(text: string): void;
  /** Shows the terminal; `preserveFocus` keeps the focus where it is. */
  show(preserveFocus: boolean): void;
  /** Calls `listener` once the editor has opened the terminal, which it does not for a terminal the user never trusts. */
  onDidOpen(listener: () => void): void;
  onDidClose(listener: () => void): void;
  dispose(): void;
}

/** The output channel the editor gives: lines appended, and a reveal that selects it and focuses the panel. */
export interface RevealableChannel {
  appendLine(text: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/** The editor operation that opening a revealable log channel needs. */
export interface ChannelPort {
  createOutputChannel(name: string): RevealableChannel;
}
