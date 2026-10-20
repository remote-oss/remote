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
  createTerminalWriter(name: string): {
    write(text: string): void;
    onDidClose(listener: () => void): void;
    dispose(): void;
  };
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
