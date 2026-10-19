import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  extensionHostEnvironmentOf,
  probedEnvironmentOf,
  probeModeOf,
  probeScriptOf,
  remoteEnvironmentOf,
} from '../../src/connect/remote-environment.ts';

const BEGIN_MARKER = 'remote-oss-env-probe-begin';
const END_MARKER = 'remote-oss-env-probe-end';

/** A folder of stub executables, each printing its text. */
function stubFolder(stubs: Record<string, string>): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'c45-'));
  for (const [name, output] of Object.entries(stubs)) {
    const file = path.join(folder, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    chmodSync(file, 0o755);
  }
  return folder;
}

/** What the loginShell script prints and ends with when `PATH` starts with the stubs. */
function ranWith(stubs: Record<string, string>): unknown {
  const folder = stubFolder(stubs);
  const result = spawnSync('/bin/sh', ['-s'], {
    input: probeScriptOf('loginShell'),
    env: {PATH: `${folder}:/usr/bin:/bin`, STUB45: '1'},
    encoding: 'utf8',
  });
  return [result.status, probedEnvironmentOf(result.stdout)?.STUB45];
}

describe('the remote environment (card containers-45)', () => {
  it('F-0416 BR-11, BR-12: the mode is the named one, and the default for an absent or unknown one', () => {
    deepStrictEqual(
      [
        undefined,
        {userEnvProbe: 'none'},
        {userEnvProbe: 'loginShell'},
        {userEnvProbe: 'interactiveShell'},
        {userEnvProbe: 'loginInteractiveShell'},
        {userEnvProbe: 42},
        {userEnvProbe: 'other'},
        {},
      ].map(probeModeOf),
      [
        'loginInteractiveShell',
        'none',
        'loginShell',
        'interactiveShell',
        'loginInteractiveShell',
        'loginInteractiveShell',
        'loginInteractiveShell',
        'loginInteractiveShell',
      ],
    );
  });

  it('F-0416 BR-11a: remoteEnv keeps strings and null, and names the others', () => {
    deepStrictEqual(
      [
        {remoteEnv: {ALPHA: 'one', BRAVO: null, CHARLIE: 3, DELTA: {}}},
        {remoteEnv: 'text'},
        {remoteEnv: null},
        undefined,
      ].map(remoteEnvironmentOf),
      [
        {entries: {ALPHA: 'one', BRAVO: null}, dropped: ['CHARLIE', 'DELTA']},
        {entries: {}, dropped: []},
        {entries: {}, dropped: []},
        {entries: {}, dropped: []},
      ],
    );
  });

  it("F-0416 BR-11: each mode's script has its flags and both markers", () => {
    const flags = {
      loginShell: ' -l -c ',
      interactiveShell: ' -i -c ',
      loginInteractiveShell: ' -l -i -c ',
    } as const;
    deepStrictEqual(
      Object.entries(flags).map(([mode, expected]) => {
        const script = probeScriptOf(mode as keyof typeof flags);
        return [
          script.includes(`"$shell"${expected}`),
          script.includes(BEGIN_MARKER),
          script.includes(END_MARKER),
        ];
      }),
      [
        [true, true, true],
        [true, true, true],
        [true, true, true],
      ],
    );
  });

  it('F-0416 BR-11: the script runs the shell getent names, else /bin/sh, and prints the exported environment between the markers', () => {
    deepStrictEqual(
      [
        ranWith({id: 'c45', getent: 'c45:x:1000:1000::/home/c45:/bin/sh'}),
        ranWith({id: 'c45'}),
      ],
      [
        [0, '1'],
        [0, '1'],
      ],
    );
  });

  it('F-0416 BR-11: the environment is what lies between the markers, whatever surrounds them', () => {
    deepStrictEqual(
      [
        `noise\n${BEGIN_MARKER}\nALPHA=1\0BRAVO=x=y\nz\0\n${END_MARKER}\nmore\n`,
        `${BEGIN_MARKER}\nALPHA=1\0\n${END_MARKER}`,
        `${BEGIN_MARKER}\nNOEQUALS\0ALPHA=1\0\n${END_MARKER}\n`,
        `${BEGIN_MARKER}\n\n${END_MARKER}\n`,
        `${BEGIN_MARKER}\nALPHA=1\0\n${END_MARKER}x\n`,
        `${BEGIN_MARKER}\nALPHA=1\0\n`,
        `ALPHA=1\0\n${END_MARKER}\n`,
        '',
      ].map(probedEnvironmentOf),
      [
        {ALPHA: '1', BRAVO: 'x=y\nz'},
        {ALPHA: '1'},
        {ALPHA: '1'},
        {},
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('F-0416 BR-11a: remoteEnv wins over the probe, null stays null, and no probe leaves remoteEnv alone', () => {
    deepStrictEqual(
      [
        extensionHostEnvironmentOf(
          {ALPHA: 'probe', BRAVO: 'probe'},
          {ALPHA: 'remote', CHARLIE: null},
        ),
        extensionHostEnvironmentOf(undefined, {CHARLIE: 'remote'}),
      ],
      [{ALPHA: 'remote', BRAVO: 'probe', CHARLIE: null}, {CHARLIE: 'remote'}],
    );
  });
});
