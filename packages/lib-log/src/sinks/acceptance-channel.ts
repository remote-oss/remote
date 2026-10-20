import type {ChannelPort} from './editor-port.ts';

/** The variable whose value `1` switches the harness's adapters on. */
const SWITCH = 'REMOTE_OSS_ACCEPTANCE';

/**
 * The channel port an extension opens its log over: the real one, whose every line the file named by `variableName`
 * also gets, when the harness's switch is on and the variable names a file; the real one itself in every other case.
 * The lines are the ones the logger writes, after its masking of secrets.
 */
export function acceptanceChannelPortFor(
  environment: Readonly<Record<string, string | undefined>>,
  variableName: string,
  real: ChannelPort,
  append: (file: string, text: string) => void,
): ChannelPort {
  const logFile = environment[variableName];
  if (environment[SWITCH] !== '1' || logFile === undefined || logFile === '') {
    return real;
  }
  return {
    createOutputChannel: name => {
      const channel = real.createOutputChannel(name);
      return {
        appendLine: text => {
          append(logFile, `${text}\n`);
          channel.appendLine(text);
        },
        show: preserveFocus => {
          channel.show(preserveFocus);
        },
        dispose: () => {
          channel.dispose();
        },
      };
    },
  };
}
