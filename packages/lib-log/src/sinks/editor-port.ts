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
