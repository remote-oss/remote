# Task card coverage-06: manifest rows for slice 1's criteria (#142)

Issue: #484. Why: coverage-03a's list (#473, draft PR #481, "Needs a unit row") names six ACs that only the manifest decides. The
manifest is already checked against the inventory by `skeleton.test.ts`'s "manifest (card remote-ssh-01 table)" rows,
but no row cites these ACs one by one. This card adds one row per AC. The whole block below was written and run on
main f6b82ed (2026-10-12): all six pass, and lint, typecheck and dupes are clean. Builder: selene.

## 1. Files

| File | Change |
|---|---|
| `packages/remote-ssh/test/unit/skeleton.test.ts` | the `describe` of section 2, appended at the end of the file |

Test files only. Don't change the manifest, `package.nls.json`, any existing row, or
`docs/architecture/catalogue/coverage-slice1.tsv`. hestia tags these ACs in #481 once your rows are on main.

## 2. The block

The file already imports `deepStrictEqual`, `readFileSync`, `path`, and defines `PACKAGE`. Append this, exactly:

```ts
describe('the manifest rows of slice 1', () => {
  /** The manifest and its default strings. */
  const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'),
  ) as {
    extensionKind: string[];
    capabilities: Record<string, unknown>;
    activationEvents: string[];
    contributes: {
      configuration: {properties: Record<string, Record<string, unknown>>};
      commands: Array<{command: string; title: string; category: string}>;
      menus: Record<string, Array<{command: string; when?: string}>>;
      keybindings?: Array<{command: string}>;
    };
  };
  const strings = JSON.parse(
    readFileSync(path.join(PACKAGE, 'package.nls.json'), 'utf8'),
  ) as Record<string, string>;
  const {properties} = manifest.contributes.configuration;

  /** The default text of a manifest value `%key%`. */
  function resolved(value: unknown): string | undefined {
    return typeof value === 'string' ? strings[value.slice(1, -1)] : undefined;
  }

  /** The menus that name `command`, and the keybindings that run it. */
  function placesOf(command: string): string[] {
    return [
      ...Object.entries(manifest.contributes.menus)
        .filter(([, entries]) =>
          entries.some(entry => entry.command === command),
        )
        .map(([menu]) => menu),
      ...(manifest.contributes.keybindings ?? [])
        .filter(binding => binding.command === command)
        .map(() => 'keybinding'),
    ];
  }

  it('F-2001 AC-19: extensionKind ui, untrusted workspaces supported, no virtual-workspace limit, no * or onStartupFinished (engines per ADR-0007)', () => {
    deepStrictEqual(
      [
        manifest.extensionKind,
        manifest.capabilities.untrustedWorkspaces,
        'virtualWorkspaces' in manifest.capabilities,
        manifest.activationEvents.filter(
          event => event === '*' || event === 'onStartupFinished',
        ),
      ],
      [['ui'], {supported: true}, false, []],
    );
  });

  it('F-2102 AC-1: remote.SSH.useLocalServer is a boolean, true by default, application scope, with the description of 3.2', () => {
    const setting = properties['remote.SSH.useLocalServer'];
    deepStrictEqual(
      [
        setting?.type,
        setting?.default,
        setting?.scope,
        resolved(setting?.markdownDescription),
      ],
      [
        'boolean',
        true,
        'application',
        'Enables a mode for connecting using a single connection shared between windows and across window reloads. This makes it faster to open new windows and reduces the number of times a password needs to be entered.',
      ],
    );
  });

  it('F-2102 AC-32: the Kill command is in no menu but the palette, and has no keybinding', () => {
    deepStrictEqual(placesOf('opensshremotes.cleanLocalServer'), [
      'commandPalette',
    ]);
  });

  it('F-2201 AC-30: remote.SSH.configFile has the description of 3.2, an empty default and application scope', () => {
    const setting = properties['remote.SSH.configFile'];
    deepStrictEqual(
      [resolved(setting?.description), setting?.default, setting?.scope],
      [
        'The absolute file path to a custom SSH config file.',
        '',
        'application',
      ],
    );
  });

  it('F-2206 AC-30: remotePlatform and windowsRemotes have the texts, deprecation message and values of 3.2', () => {
    const platform = properties['remote.SSH.remotePlatform'];
    const windows = properties['remote.SSH.windowsRemotes'];
    deepStrictEqual(
      [
        resolved(platform?.markdownDescription),
        (platform?.additionalProperties as {enum?: string[]} | undefined)?.enum,
        resolved(windows?.markdownDescription),
        windows?.deprecationMessage,
      ],
      [
        "A map of the remote hostname to the platform for that remote. The hostname may include a star '*' to wildcard match. Valid values: `linux`, `macOS`, `windows`. Note - this setting will soon be required when `#remote.SSH.useLocalServer#` is disabled, so it is currently being autopopulated for successful connections, but is not currently used.",
        ['macOS', 'windows', 'linux'],
        '**Deprecated**: Enables experimental support for connecting to Windows remotes. Add the names of windows remotes to this list.',
        'Deprecated: Please use `#remote.SSH.remotePlatorm#` instead',
      ],
    );
  });

  it('F-2301 AC-1: "Remote-SSH: Connect to Host..." is in the palette unconditionally and has no keybinding', () => {
    const command = manifest.contributes.commands.find(
      entry => entry.command === 'opensshremotes.openEmptyWindow',
    );
    deepStrictEqual(
      [
        command?.category,
        resolved(command?.title),
        manifest.contributes.menus.commandPalette?.filter(
          entry => entry.command === 'opensshremotes.openEmptyWindow',
        ),
        manifest.contributes.keybindings?.filter(
          binding => binding.command === 'opensshremotes.openEmptyWindow',
        ) ?? [],
      ],
      ['Remote-SSH', 'Connect to Host...', [], []],
    );
  });
});
```

## 3. Notes for the review

- F-2001 AC-19 says `engines.vscode` is `^1.133.0`. Ours is `^1.139.0` by ADR-0007 (the editor floor), already pinned
  by the row `manifest top-level fields: the card values, one by one`. The row checks the rest and says so in its name.
- The Settings editor's display (the "checked" box, the all-profiles marker) is core's. These rows check the manifest
  values core shows.

## 4. Done when

- the six rows are in and pass;
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm dupes` and `pnpm coverage` pass;
- once #467 has merged, `pnpm check-coverage` passes too.

If a row fails as written, don't change the expected value. Stop and report the actual value on the issue: it means the
manifest changed after this card was written.

## 5. Review

PR title `tests: manifest rows for slice 1's criteria (card coverage-06, #142)`. themis or triton reviews.
