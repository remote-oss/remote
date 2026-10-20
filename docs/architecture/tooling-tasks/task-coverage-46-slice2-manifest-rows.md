# Task card coverage-46: the manifest rows of Remote - SSH slice 2 (nine settings criteria)

Issue: #1156. Release 0.2. Size: S. Builder: `task:local` (selene). Design: coverage-44 (#1114, athena's change: rows may cover the
nine reviewed slice-2 specs). Every value below was checked against `packages/remote-ssh/package.json` and
`package.nls.json` on main (daedalus, 2026-10-20), and each one matches its spec's §3.2 row. If a row fails, the
manifest changed: stop and comment on this issue with the failing value. Don't change the manifest or the expected
value.

## 1. Where

`packages/remote-ssh/test/unit/skeleton.test.ts`, in the block `describe('the manifest rows of slice 1', () => {`
that runs to the end of the file:
- Rename the block to `describe('the manifest rows of slices 1 and 2', () => {`.
- In the block's `manifest` type, change `configuration: {properties: Record<string, Record<string, unknown>>};` to
  `configuration: {title: string; properties: Record<string, Record<string, unknown>>};`.
- Add the nine `it`s below **at the end of the block**, before its closing `});`, in this order. Use the block's
  `properties` and `resolved`. No new helper, no new import.

## 2. The rows

```ts
  it('F-2104 AC-1: remote.SSH.enableDynamicForwarding is a boolean, true by default, application scope, with the description of 3.2', () => {
    const setting = properties['remote.SSH.enableDynamicForwarding'];
    deepStrictEqual(
      [setting?.type, setting?.default, setting?.scope, resolved(setting?.description)],
      [
        'boolean',
        true,
        'application',
        'Whether to use SSH dynamic forwarding to allow setting up new port tunnels over an existing SSH connection. When this is used, a password only needs to be entered once for each remote window.',
      ],
    );
  });

  it('F-2104 AC-2: remote.SSH.preferredLocalPortRange is an empty string, application scope, with the markdown description of 3.2, and a pattern core checks with its own message', () => {
    const setting = properties['remote.SSH.preferredLocalPortRange'];
    const pattern = new RegExp(String(setting?.pattern));
    deepStrictEqual(
      [
        setting?.type,
        setting?.default,
        setting?.scope,
        resolved(setting?.markdownDescription),
        setting?.pattern,
        'patternErrorMessage' in (setting ?? {}),
        pattern.test('abc'),
        pattern.test('41090-41080'),
      ],
      [
        'string',
        '',
        'application',
        "A range of **local** ports preferred to utilize for the SSH tunnel connection. If no free port is found in range, an error will be thrown. Valid ranges of the form `number-number` such as `4000-5000`; it's expected the first number will be lower than the next.",
        '^\\d+-\\d+$|^$',
        false,
        false,
        true,
      ],
    );
  });

  it('F-2106 AC-11: remote.SSH.permitPtyAllocation is a boolean, false by default, application scope (so no Remote or Workspace value), with the description of 3.2', () => {
    const setting = properties['remote.SSH.permitPtyAllocation'];
    deepStrictEqual(
      [setting?.type, setting?.default, setting?.scope, resolved(setting?.markdownDescription)],
      [
        'boolean',
        false,
        'application',
        "Permits the system to allocate a pseudo-terminal for the SSH connection (by omitting the '-T' SSH connection flag). This setting is disabled by default and may be enabled to support specific use-cases.",
      ],
    );
  });

  it('F-2308 AC-1: remote.SSH.showLoginTerminal is a boolean, false by default, application scope, with the description of 3.2', () => {
    const setting = properties['remote.SSH.showLoginTerminal'];
    deepStrictEqual(
      [setting?.type, setting?.default, setting?.scope, resolved(setting?.description)],
      ['boolean', false, 'application', 'Always reveal the SSH login terminal.'],
    );
  });

  it('F-2312 AC-1, AC-33: remote.SSH.enableX11Forwarding is a boolean, true by default, application scope (so no Remote value), with the description of 3.2', () => {
    const setting = properties['remote.SSH.enableX11Forwarding'];
    deepStrictEqual(
      [setting?.type, setting?.default, setting?.scope, resolved(setting?.markdownDescription)],
      [
        'boolean',
        true,
        'application',
        "Enable fixing the remote environment so that the SSH config option `ForwardX11` will take effect as expected from VS Code's remote extension host.",
      ],
    );
  });

  it('F-2405 AC-19: remote.SSH.localServerDownload has the description, values and value texts of 3.2, auto by default, and the old key points to it', () => {
    const setting = properties['remote.SSH.localServerDownload'];
    const values = (setting?.enum ?? []) as string[];
    const texts = (setting?.enumDescriptions ?? []) as unknown[];
    deepStrictEqual(
      [
        setting?.type,
        setting?.default,
        setting?.scope,
        resolved(setting?.description),
        // The value texts are literal in the manifest, not keys of the string table.
        values.map((value, index) => [value, texts[index]]),
        [...values].sort(),
        properties['remote.SSH.allowLocalServerDownload']?.markdownDeprecationMessage,
      ],
      [
        'string',
        'auto',
        'application',
        'Whether the extension can download the VS Code Server on the client and transfer it to the host with scp, instead of downloading it on the host.',
        [
          ['auto', 'The server will first be downloaded on the host, and if that fails, will fall back to downloading locally'],
          ['always', 'The server will only be downloaded locally and transferred to the host'],
          ['off', 'The server will only be downloaded on the host'],
        ],
        ['always', 'auto', 'off'],
        'Deprecated, please use `#remote.SSH.localServerDownload#`',
      ],
    );
  });

  it('F-2410 AC-1: remote.SSH.remoteServerListenOnSocket is a boolean, false by default, with no scope (so not for all profiles), with the markdown description of 3.2', () => {
    const setting = properties['remote.SSH.remoteServerListenOnSocket'];
    deepStrictEqual(
      [setting?.type, setting?.default, 'scope' in (setting ?? {}), resolved(setting?.markdownDescription)],
      [
        'boolean',
        false,
        false,
        'When true, the remote VS Code server will listen on a socket path instead of opening a port. Only valid for Linux and macOS remotes. After toggling this setting, run the command "Kill VS Code Server on Host..." for it to take effect. Requires OpenSSH 6.7+. Disables the "local server" connection multiplexing mode. Requires `AllowStreamLocalForwarding` to be enabled for the SSH server.',
      ],
    );
  });

  it('F-2507 AC-1: remote.SSH.defaultForwardedPorts is an array of objects with a required remotePort, empty by default, with no scope, under Remote - SSH, with the description of 3.2', () => {
    const setting = properties['remote.SSH.defaultForwardedPorts'];
    const items = setting?.items as {type?: string; required?: string[]} | undefined;
    deepStrictEqual(
      [
        manifest.contributes.configuration.title,
        setting?.type,
        setting?.default,
        'scope' in (setting ?? {}),
        items?.type,
        items?.required,
        resolved(setting?.description),
      ],
      [
        'Remote - SSH',
        'array',
        [],
        false,
        'object',
        ['remotePort'],
        'A list of ports to forward when the connection is established.',
      ],
    );
  });
```

That's eight `it`s covering nine criteria: F-2312 AC-1 and AC-33 share one row.

- Run Prettier on the file (`npx prettier --write packages/remote-ssh/test/unit/skeleton.test.ts`). It rewraps the
  long arrays; that's expected.
- daedalus ran these exact rows on main after Prettier: 39 passing in the file, ESLint clean, 0 clones.

## 3. Coverage

`docs/architecture/catalogue/coverage-slice1.tsv`: these nine lines go from `todo` to `unit`: F-2104.AC-1,
F-2104.AC-2, F-2106.AC-11, F-2308.AC-1, F-2312.AC-1, F-2312.AC-33, F-2405.AC-19, F-2410.AC-1 and F-2507.AC-1.
`node tools/check-coverage.ts` must pass. Then `grep -c` should find each new row's cite in the test file.

## 4. Done when

- `npx mocha --no-config --extension ts packages/remote-ssh/test/unit/skeleton.test.ts` passes. The slice-1 rows in
  the same block still pass.
- `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js packages/remote-ssh/test/unit/skeleton.test.ts`
  is clean, `pnpm dupes` finds 0 clones, and `node tools/check-coverage.ts` passes.
- PR title: `tests: the manifest rows of Remote - SSH slice 2 (card coverage-46, #1156)`. Request athena only.
