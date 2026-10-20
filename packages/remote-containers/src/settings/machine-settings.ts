/**
 * @fileoverview The container's machine settings file: the text that sets this extension's keys in it, and the write
 * of that text over the exec channel before the server starts.
 */

import {applyEdits, modify} from 'jsonc-parser';
import {type HostChannel, posixQuote} from 'lib-host';

/** The settings this extension writes into the container's machine settings, by key. */
export type MachineSettings = Readonly<Record<string, unknown>>;

/** The formatting of the keys this extension adds: two spaces, as the editor writes its own settings files. */
const FORMATTING = {insertSpaces: true, tabSize: 2} as const;

/** The file's new text: `current` (JSONC or empty) with each key of `settings` set, other keys and comments kept. */
export function machineSettingsText(
  current: string,
  settings: MachineSettings,
): string {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return current;
  }
  let text = current.trim() === '' ? '{}' : current;
  for (const [key, value] of entries) {
    text = applyEdits(
      text,
      modify(text, [key], value, {formattingOptions: FORMATTING}),
    );
  }
  return text;
}

/** How the write ended. */
export type MachineSettingsWrite =
  {kind: 'unchanged'} | {kind: 'written'} | {kind: 'failed'; detail: string};

/** The file, in the server's data folder as the editor's server reads it. */
function settingsFileOf(dataFolder: string): string {
  return `${dataFolder}/data/Machine/settings.json`;
}

/** Reads the file as the lines of its base64, which survive the line-by-line output; a missing file gives none. */
async function readSettingsFile(
  channel: HostChannel,
  file: string,
  cancellation: AbortSignal,
): Promise<{kind: 'read'; text: string} | {kind: 'failed'; detail: string}> {
  const lines: string[] = [];
  const outcome = await channel.runScript(
    {
      script: `if [ -f ${posixQuote(file)} ]; then base64 < ${posixQuote(file)}; fi`,
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation,
    },
    line => lines.push(line),
  );
  if (outcome.kind === 'failed') {
    return {kind: 'failed', detail: outcome.failure.detail};
  }
  return outcome.status === 0
    ? {
        kind: 'read',
        text: Buffer.from(lines.join(''), 'base64').toString('utf8'),
      }
    : {
        kind: 'failed',
        detail: `settings file not read (exit ${String(outcome.status)})`,
      };
}

/** Writes the text beside the file and moves it over, as the channel's user. */
async function writeSettingsFile(
  channel: HostChannel,
  file: string,
  text: string,
  cancellation: AbortSignal,
): Promise<MachineSettingsWrite> {
  const part = posixQuote(`${file}.part`);
  const outcome = await channel.runScript(
    {
      script: [
        'set -e',
        'umask 022',
        `mkdir -p ${posixQuote(file.slice(0, file.lastIndexOf('/')))}`,
        `cat > ${part}`,
        `mv -f ${part} ${posixQuote(file)}`,
      ].join('\n'),
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text},
      cancellation,
    },
    () => undefined,
  );
  if (outcome.kind === 'failed') {
    return {kind: 'failed', detail: outcome.failure.detail};
  }
  return outcome.status === 0
    ? {kind: 'written'}
    : {
        kind: 'failed',
        detail: `settings file not written (exit ${String(outcome.status)})`,
      };
}

/**
 * Sets `settings` in the machine settings file under `dataFolder`: the file is read (a missing one is empty), and it is
 * written only when its text changes. With no settings nothing runs.
 */
export async function writeMachineSettings(
  channel: HostChannel,
  dataFolder: string,
  settings: MachineSettings,
  cancellation: AbortSignal,
): Promise<MachineSettingsWrite> {
  if (Object.keys(settings).length === 0) {
    return {kind: 'unchanged'};
  }
  const file = settingsFileOf(dataFolder);
  const current = await readSettingsFile(channel, file, cancellation);
  if (current.kind === 'failed') {
    return current;
  }
  const text = machineSettingsText(current.text, settings);
  return text === current.text
    ? {kind: 'unchanged'}
    : writeSettingsFile(channel, file, text, cancellation);
}
