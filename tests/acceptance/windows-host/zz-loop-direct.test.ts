/**
 * @fileoverview A measurement for card #2681, on its measure branch only: the session loop over plain `ssh` to
 * `winhost` with its standard input kept open, as the extension keeps it, under each DefaultShell.
 */

import {execFileSync, spawn} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  powershellCommandsFor,
  powershellSessionStart,
} from '../../../packages/lib-ssh/src/connection-server/powershell-session.ts';
import {variable} from '../windows/harness.ts';

const OPENSSH_KEY = 'HKLM\\SOFTWARE\\OpenSSH';

const SHELLS = {
  windowsPowershell:
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  commandPrompt: 'C:\\Windows\\System32\\cmd.exe',
  powershellSeven: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
} as const;

function useShell(program: string): void {
  execFileSync('reg', [
    'add',
    OPENSSH_KEY,
    '/v',
    'DefaultShell',
    '/t',
    'REG_SZ',
    '/d',
    program,
    '/f',
  ]);
}

/**
 * Starts the loop with stdin open. With `early`, the frame goes at once; otherwise once `LAYER1-READY` is read. The
 * input closes `holdMilliseconds` after the frame. Prints the timeline of the markers and what stderr said.
 */
async function measure(label: string, early: boolean, holdMilliseconds: number, emptyFirst = false, variant: {hide?: boolean; extra?: string[]; env?: Record<string, string>} = {}, script = 'Write-Output "platform: $([Environment]::OSVersion.Platform)"', inputBase64: string | null = null): Promise<void> {
  const {remoteProgram} = powershellSessionStart();
  const frame = powershellCommandsFor('c2681mark', {
    script,
    environment: {GREETING: 'x'},
    inputBase64,
  });
  const started = Date.now();
  const events: string[] = [];
  const note = (what: string) => events.push(`${String(Date.now() - started)}ms ${what}`);
  const child = spawn('ssh', ['-T', ...(variant.extra ?? []), '-F', variable('HARNESS_SSH_CONFIG'), 'winhost', remoteProgram], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: variant.hide ?? false,
    env: {...process.env, ...(variant.env ?? {})},
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  let written = false;
  const writeFrame = () => {
    if (written) {
      return;
    }
    written = true;
    if (emptyFirst) {
      child.stdin.write('');
      note('empty write');
    }
    child.stdin.write(frame);
    note('frame written');
    setTimeout(() => {
      note('stdin closed');
      child.stdin.end();
    }, holdMilliseconds);
  };
  child.stdin.on('error', error => note(`stdin error ${String(error)}`));
  child.stdout.on('data', (chunk: string) => {
    const text = chunk;
    stdout += text;
    note(`stdout ${JSON.stringify(text.slice(0, 200))}`);
    if (!early && stdout.includes('LAYER1-READY')) {
      writeFrame();
    }
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  if (early) {
    writeFrame();
  }
  const killer = setTimeout(() => {
    note('killed');
    child.kill();
  }, holdMilliseconds + 30_000);
  const status = await new Promise<number | null>(resolve => child.once('close', resolve));
  clearTimeout(killer);
  note(`exit ${String(status)}`);
  console.log(`c2681-measure ${label}: ${JSON.stringify({events, stderr: stderr.slice(0, 3000)})}`);
}

/** The loop with stdin open and `frame` written once the ready line is read, with the timeline printed. */
async function measureFrame(label: string, frame: string, invocation?: {program: string; arguments: string[]; environment: Record<string, string>}): Promise<void> {
  const {remoteProgram} = powershellSessionStart();
  const started = Date.now();
  const events: string[] = [];
  const note = (what: string) => events.push(`${String(Date.now() - started)}ms ${what}`);
  const child =
    invocation === undefined
      ? spawn('ssh', ['-T', '-F', variable('HARNESS_SSH_CONFIG'), 'winhost', remoteProgram], {stdio: ['pipe', 'pipe', 'pipe']})
      : spawn(invocation.program, invocation.arguments, {stdio: ['pipe', 'pipe', 'pipe'], env: invocation.environment, windowsHide: true});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let written = false;
  child.stdout.on('data', (text: string) => {
    stdout += text;
    note(`stdout ${JSON.stringify(text.slice(0, 160))}`);
    if (!written && stdout.includes('LAYER1-READY')) {
      written = true;
      child.stdin.write(frame);
      note('frame written');
    }
  });
  child.stderr.on('data', (text: string) => note(`stderr ${JSON.stringify(text.slice(0, 160))}`));
  const killer = setTimeout(() => {
    note('killed');
    child.kill();
  }, 20_000);
  await new Promise(resolve => child.once('close', resolve));
  clearTimeout(killer);
  console.log(`c2681-measure ${label}: ${JSON.stringify(events)}`);
}

/** Runs `remoteProgram`, writes `frame` `delay` ms after its first output line, and prints the timeline. */
async function measureDelayed(label: string, frame: string, delay: number, remoteProgram: string): Promise<void> {
  const started = Date.now();
  const events: string[] = [];
  const note = (what: string) => events.push(`${String(Date.now() - started)}ms ${what}`);
  const child = spawn('ssh', ['-T', '-F', variable('HARNESS_SSH_CONFIG'), 'winhost', remoteProgram], {stdio: ['pipe', 'pipe', 'pipe']});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let armed = false;
  child.stdout.on('data', (text: string) => {
    note(`stdout ${JSON.stringify(text.slice(0, 160))}`);
    if (!armed) {
      armed = true;
      setTimeout(() => {
        child.stdin.write(frame);
        note('frame written');
      }, delay);
    }
  });
  const killer = setTimeout(() => {
    note('killed');
    child.kill();
  }, delay + 12_000);
  await new Promise(resolve => child.once('close', resolve));
  clearTimeout(killer);
  console.log(`c2681-measure ${label}: ${JSON.stringify(events)}`);
}

describe('the Windows session loop with its input kept open (card #2681, measurement)', function () {
  this.timeout(900_000);

  it('print what the host ran during the connects', () => {
    const watchFile = path.join(variable('HARNESS_RUN_FOLDER'), 'process-watch.txt');
    const lines = existsSync(watchFile) ? readFileSync(watchFile, 'utf8').split('\n') : [];
    const seen = new Map<string, string>();
    for (const line of lines) {
      const key = line.split(' ').slice(1).join(' ');
      if (key !== '' && !seen.has(key)) {
        seen.set(key, line.split(' ')[0] ?? '');
      }
    }
    console.log(`c2681-measure processes: ${JSON.stringify([...seen].map(([key, first]) => `${first} ${key}`).slice(0, 200))}`);
    const events = execFileSync('powershell', ['-NoProfile', '-Command', "Get-WinEvent -LogName 'OpenSSH/Operational' -MaxEvents 120 | Sort-Object TimeCreated | ForEach-Object { $_.TimeCreated.ToString('HH:mm:ss.fff') + ' ' + ($_.Message -replace '\\s+', ' ') }"], {encoding: 'utf8'});
    console.log(`c2681-measure sshd events: ${JSON.stringify(events.split('\n').slice(-120))}`);
  });

  it('measure delayed frames under each DefaultShell, and through cmd', async () => {
    const frame = powershellCommandsFor('c2681mark', {script: 'Write-Output "platform: $([Environment]::OSVersion.Platform)"', environment: {}, inputBase64: null});
    const loop = powershellSessionStart().remoteProgram;
    for (const [name, program] of Object.entries(SHELLS)) {
      useShell(program);
      await measureDelayed(`${name} delay 200`, frame, 200, loop);
      await measureDelayed(`${name} cmd-wrapped delay 200`, frame, 200, `cmd /c ${loop}`);
    }
    useShell(SHELLS.windowsPowershell);
  });

  it('print the helper summaries', () => {
    for (const name of readdirSync(tmpdir()).filter(each => each.startsWith('c2681-summary-')).sort()) {
      console.log(`c2681-measure summary ${name}: ${JSON.stringify(readFileSync(path.join(tmpdir(), name), 'utf8').split('\n').slice(0, 80))}`);
    }
  });

  it('replay the frames the helper wrote, over plain ssh', async () => {
    useShell(SHELLS.windowsPowershell);
    const saved = readdirSync(tmpdir()).filter(name => name.startsWith('c2681-frame-')).sort();
    console.log(`c2681-measure saved frames: ${JSON.stringify(saved)}`);
    for (const name of saved.slice(0, 2)) {
      const frame = readFileSync(path.join(tmpdir(), name), 'utf8');
      const header = frame.slice(0, frame.indexOf('\n'));
      console.log(`c2681-measure frame ${name}: ${JSON.stringify({length: frame.length, bytes: Buffer.byteLength(frame), header: header.replace(/^\S+/, 'MARKER'), crs: (frame.match(/\r/g) ?? []).length, nonAscii: (frame.match(/[^\x00-\x7f]/g) ?? []).length, tail: frame.slice(-120)})}`);
      await measureFrame(`replay ${name}`, frame);
      const invocations = readdirSync(tmpdir()).filter(each => each.startsWith('c2681-invocation-')).sort();
      for (const each of invocations.slice(0, 1)) {
        const saved = JSON.parse(readFileSync(path.join(tmpdir(), each), 'utf8')) as {program: string; arguments: string[]; askpassEnvironment: Record<string, string>; editorEnvironment: Record<string, string>};
        console.log(`c2681-measure invocation: ${JSON.stringify({program: saved.program, arguments: saved.arguments, askpass: Object.keys(saved.askpassEnvironment), editor: Object.keys(saved.editorEnvironment).length})}`);
        const environment = {...saved.editorEnvironment, ...saved.askpassEnvironment};
        await measureFrame('replay with the invocation', frame, {program: saved.program, arguments: saved.arguments.filter(each => each !== '-vvv'), environment});
        await measureFrame('replay with the invocation at -vvv', frame, {program: saved.program, arguments: ['-vvv', ...saved.arguments], environment});
      }
    }
  });

  after(() => {
    useShell(SHELLS.windowsPowershell);
  });
});
