import {acceptanceLogFileOf} from './acceptance-channel.ts';
import type {EditorLogPort} from './editor-port.ts';

/**
 * The terminal port an extension streams its log terminal over: the real one, whose every write of
 * every terminal also lands, as written, in the file the variable `variableName` names, when the
 * harness's switch is on and the variable names a file; the real one itself in every other case.
 * The writes are the ones the terminal gets: the escapes and the `\r\n` line ends, after lib-log's
 * masking and, once #2329 lands, after `escapeControls`.
 */
export function acceptanceTerminalPortFor(
  environment: Readonly<Record<string, string | undefined>>,
  variableName: string,
  real: EditorLogPort,
  append: (file: string, text: string) => void,
): EditorLogPort {
  const logFile = acceptanceLogFileOf(environment, variableName);
  if (logFile === undefined) {
    return real;
  }
  return {
    createOutputChannel: name => real.createOutputChannel(name),
    createTerminalWriter: name => {
      const writer = real.createTerminalWriter(name);
      return {
        write: text => {
          append(logFile, text);
          writer.write(text);
        },
        onDidClose: listener => {
          writer.onDidClose(listener);
        },
        dispose: () => {
          writer.dispose();
        },
      };
    },
  };
}
