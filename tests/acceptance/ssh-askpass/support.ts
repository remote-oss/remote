/**
 * @fileoverview What the rows of the `ssh-askpass` launch share (F-2309): the stand-in askpass program the editor's
 * `SSH_ASKPASS` names, the recorder that comes before `ssh` on the editor's PATH, and the watch of a window that
 * connects for a VS Code input.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {
  connectedWithin,
  hostPassword,
  openWindow,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {inputBoxOf, quickPickOf} from '../windows/renderer.ts';

/** The folder the launch's `SSH_ASKPASS` and `PATH` name. */
function askpassFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'askpass-bin');
}

/** The file the stand-in askpass appends one line to for each call. */
function callsFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'askpass-calls.jsonl');
}

/** The file the recorder appends one line to for each `ssh` it starts: the variables that matter to the askpass. */
function sshFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'ssh-environments.jsonl');
}

/** The file the stand-in askpass reads its answers from, at each call. */
function answersFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'askpass-answers.json');
}

/** How the stand-in answers a question: the first rule whose `match` the question holds (ignoring case) is used. */
export interface AnswerRule {
  match: string;
  answer: string;
  /** How long the program waits before it answers, in milliseconds. */
  delayMilliseconds?: number;
  /** The exit status; non-zero is a program that cancels. */
  status?: number;
}

/** One call of the stand-in askpass, as it recorded it. */
export interface AskpassCall {
  prompt: string;
  SSH_ASKPASS: string;
  SSH_ASKPASS_REQUIRE: string;
  DISPLAY: string;
}

/** One `ssh` the recorder saw, with the variables of its environment; `<unset>` for a variable that is not set. */
export interface SshEnvironment {
  /** The arguments `ssh` was started with, joined by spaces. */
  arguments: string;
  SSH_ASKPASS: string;
  SSH_ASKPASS_REQUIRE: string;
  DISPLAY: string;
  WAYLAND_DISPLAY: string;
}

/** The program: one JSON line per call, then the answer of the first rule that matches, or a cancel. */
const ANSWER_PROGRAM = `
const {appendFileSync, readFileSync} = require('node:fs');
const prompt = process.argv[2] ?? '';
const environment = process.env;
appendFileSync(process.argv[3], JSON.stringify({
  prompt,
  SSH_ASKPASS: environment.SSH_ASKPASS ?? '<unset>',
  SSH_ASKPASS_REQUIRE: environment.SSH_ASKPASS_REQUIRE ?? '<unset>',
  DISPLAY: environment.DISPLAY ?? '<unset>',
}) + '\\n');
let rules = [];
try {
  rules = JSON.parse(readFileSync(process.argv[4], 'utf8'));
} catch {}
const rule = rules.find(each => prompt.toLowerCase().includes(each.match.toLowerCase()));
if (rule === undefined || (rule.status ?? 0) !== 0) {
  process.exit(rule === undefined ? 1 : rule.status);
}
setTimeout(() => {
  process.stdout.write(rule.answer + '\\n');
}, rule.delayMilliseconds ?? 0);
`;

/** The recorder: one JSON line per `ssh` with its arguments and the variables of its environment. */
const RECORD_PROGRAM = `
const {appendFileSync} = require('node:fs');
const environment = process.env;
appendFileSync(process.argv[2], JSON.stringify({
  arguments: process.argv.slice(3).join(' '),
  SSH_ASKPASS: environment.SSH_ASKPASS ?? '<unset>',
  SSH_ASKPASS_REQUIRE: environment.SSH_ASKPASS_REQUIRE ?? '<unset>',
  DISPLAY: environment.DISPLAY ?? '<unset>',
  WAYLAND_DISPLAY: environment.WAYLAND_DISPLAY ?? '<unset>',
}) + '\\n');
`;

/**
 * Writes the stand-ins into the run's folder: the askpass program, which logs each call and answers from the answers
 * file, and an `ssh` that logs the variables of its own environment and then runs the real one.
 */
export function writeStandIns(): void {
  const folder = askpassFolder();
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, 'answer.cjs'), ANSWER_PROGRAM);
  writeFileSync(
    path.join(folder, 'answer'),
    `#!/bin/sh\nexec '${process.execPath}' '${path.join(folder, 'answer.cjs')}' "$1" '${callsFile()}' '${answersFile()}'\n`,
  );
  chmodSync(path.join(folder, 'answer'), 0o755);
  writeFileSync(path.join(folder, 'record.cjs'), RECORD_PROGRAM);
  writeFileSync(
    path.join(folder, 'ssh'),
    `#!/bin/sh\n'${process.execPath}' '${path.join(folder, 'record.cjs')}' '${sshFile()}' "$@"\nexec /usr/bin/ssh "$@"\n`,
  );
  chmodSync(path.join(folder, 'ssh'), 0o755);
  clearRecords();
}

/** Empties the two records and the answers, so a row sees only its own calls. */
export function clearRecords(): void {
  writeFileSync(callsFile(), '');
  writeFileSync(sshFile(), '');
  writeFileSync(answersFile(), '[]');
}

/** Sets the answers the stand-in gives from now on. */
export function answering(rules: readonly AnswerRule[]): void {
  writeFileSync(answersFile(), JSON.stringify(rules));
}

/** The answer of the host's password account `harness-pw` to the password question. */
export function passwordRule(): AnswerRule {
  return {match: 'password', answer: hostPassword()};
}

/** The calls of the stand-in askpass since the records were last cleared. */
export function askpassCalls(): AskpassCall[] {
  return linesOf<AskpassCall>(callsFile());
}

/** The `ssh` environments the recorder saw since the records were last cleared. */
export function sshEnvironments(): SshEnvironment[] {
  return linesOf<SshEnvironment>(sshFile());
}

function linesOf<Line>(file: string): Line[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
        .map(line => JSON.parse(line) as Line)
    : [];
}

/** Sets `remote.SSH.externalSSH_ASKPASS`, with the other settings of a row, and waits for the window to read them. */
export async function withSettings(
  settings: Record<string, unknown>,
): Promise<void> {
  await userSettings(settings);
}

/** What a window that connected to the password alias showed of VS Code inputs while it did. */
export interface WatchedConnect {
  connected: boolean;
  /** The placeholder or title of each distinct input or pick the window showed, in order. */
  inputs: string[];
}

/**
 * Opens window `name` on `alias` and watches it for up to `milliseconds` for a VS Code input (an input box or a pick)
 * until it is connected: what the extension's own prompts would be.
 */
export async function watchedConnect(
  alias: string,
  name: string,
  milliseconds: number,
): Promise<WatchedConnect> {
  await openWindow(alias, name);
  const inputs: string[] = [];
  const state = {done: false, connected: false};
  const waiting = connectedWithin(name, milliseconds).then(
    () => {
      state.connected = true;
      state.done = true;
    },
    () => {
      state.done = true;
    },
  );
  while (!state.done) {
    const input = await inputBoxOf(name).catch(() => undefined);
    const pick = await quickPickOf(name).catch(() => undefined);
    for (const label of [input?.placeholder, pick?.placeholder]) {
      if (label !== undefined && label !== '' && !inputs.includes(label)) {
        inputs.push(label);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await waiting;
  return {connected: state.connected, inputs};
}

/** The known-hosts file of the alias `name` in the run's SSH configuration. */
export function knownHostsOf(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), `known_hosts_${name}`);
}

/** Empties the known-hosts file of the alias `name`, so that its host key is unknown. */
export function forgetHostKey(name: string): void {
  rmSync(knownHostsOf(name), {force: true});
}

/** Puts the host key of the SSH host into the known-hosts file of the alias `name`, so that the key is known. */
export function knowHostKey(name: string): void {
  const config = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  const port = /^\s+Port (\d+)$/m.exec(config)?.[1];
  if (port === undefined) {
    throw new Error('the run’s SSH configuration names no port');
  }
  const scanned = spawnSync('ssh-keyscan', ['-p', port, '127.0.0.1'], {
    encoding: 'utf8',
  }).stdout;
  writeFileSync(knownHostsOf(name), scanned);
}
