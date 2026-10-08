/**
 * @fileoverview Reads the option list that `ssh -G <alias>` prints: one lower-case keyword and its value per line,
 * repeated for options such as `localforward`.
 */

/** The options the library uses, as OpenSSH computed them for one target. */
export interface EffectiveOptions {
  hostName: string;
  user: string;
  port: string;
  /** Absent when the configuration sets none. */
  connectTimeout?: string;
  /** Absent when the configuration sets none. */
  remoteCommand?: string;
  /** Each `LocalForward` in the order printed, as `<listen> <target>`. */
  localForwards: string[];
}

/** The outcome of reading `ssh -G` output: the options, or the reason they could not be read. */
export type EffectiveOptionsResult =
  {options: EffectiveOptions} | {parseError: string};

/** The values `ssh -G` prints for an option that is not set. */
const UNSET_VALUES = new Set(['', 'none']);

/** Parses the text `ssh -G` printed for one target. */
export function parseEffectiveOptions(text: string): EffectiveOptionsResult {
  const values = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') {
      continue;
    }
    const separator = trimmed.indexOf(' ');
    const keyword = (
      separator < 0 ? trimmed : trimmed.slice(0, separator)
    ).toLowerCase();
    const value = separator < 0 ? '' : trimmed.slice(separator + 1);
    values.set(keyword, [...(values.get(keyword) ?? []), value]);
  }
  const hostName = values.get('hostname')?.[0];
  const user = values.get('user')?.[0];
  const port = values.get('port')?.[0];
  if (hostName === undefined || user === undefined || port === undefined) {
    return {parseError: 'the output names no hostname, user or port'};
  }
  const options: EffectiveOptions = {
    hostName,
    user,
    port,
    localForwards: values.get('localforward') ?? [],
  };
  const connectTimeout = values.get('connecttimeout')?.[0];
  if (connectTimeout !== undefined && !UNSET_VALUES.has(connectTimeout)) {
    options.connectTimeout = connectTimeout;
  }
  const remoteCommand = values.get('remotecommand')?.[0];
  if (remoteCommand !== undefined && !UNSET_VALUES.has(remoteCommand)) {
    options.remoteCommand = remoteCommand;
  }
  return {options};
}
