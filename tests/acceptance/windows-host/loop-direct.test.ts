/**
 * @fileoverview A measurement for card #2681, on its measure branch only: the session loop over plain `ssh` to
 * `winhost` with its standard input kept open, as the extension keeps it, under each DefaultShell.
 */

import {execFileSync, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
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

describe('the Windows session loop with its input kept open (card #2681, measurement)', function () {
  this.timeout(900_000);

  it('measure the helper\'s spawn options one by one, under Windows PowerShell', async () => {
    useShell(SHELLS.windowsPowershell);
    const askpass = {SSH_ASKPASS: 'C:\\Windows\\System32\\cmd.exe', SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0'};
    await measure('plain', false, 5_000);
    await measure('hide', false, 5_000, false, {hide: true});
    await measure('dynamic', false, 5_000, false, {extra: ['-D', '127.0.0.1:53111']});
    await measure('verbose', false, 5_000, false, {extra: ['-v']});
    await measure('askpass', false, 5_000, false, {env: askpass});
    await measure('all', false, 5_000, false, {hide: true, extra: ['-v', '-D', '127.0.0.1:53112'], env: askpass});
  });

  after(() => {
    useShell(SHELLS.windowsPowershell);
  });
});
