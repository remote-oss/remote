# Task card coverage-07: unit rows for the host list and the typed target's title (#142)

Issue: #495. Why: coverage-03a's list (#473, draft PR #481, "Needs a unit row") names three more ACs that our code already decides,
with no row citing them: F-2201 AC-25 and AC-2 (the host list) and F-2304 AC-29 (the progress title of a typed target).
Each row below was written and run on main f6b82ed (2026-10-12): all three pass, and lint and typecheck are clean.
Builder: selene.

## 1. Files

| File | Change |
|---|---|
| `packages/lib-ssh/test/unit/hosts.test.ts` | row 1, at the end of `describe('listHosts (the host entries of the files in effect)', …)` |
| `packages/remote-ssh/test/unit/connect-picker-model.test.ts` | row 2, at the end of `describe('pickerModel (card remote-ssh-02)', …)` |
| `packages/remote-ssh/test/unit/connect-ports.test.ts` | row 3, just before the row `'F-2304: a stage shows its own message'` |

Test files only. Don't change any source file, any existing row, or `docs/architecture/catalogue/coverage-slice1.tsv`.
hestia tags these ACs in #481 once your rows are on main. Each file already has every helper and import the rows use
(`names`, `pickerModel`, `assemblyInputs`, `connectAssemblyOf`, `loggerOf`, `decoded`, `deepStrictEqual`).

## 2. The rows, exactly

Row 1 (`hosts.test.ts`). A listing that isn't a parse error shows no message, and `names` throws on a parse error:

```ts
  it('F-2201 AC-25: a garbage line, an unknown keyword and a quoted pattern list the valid hosts, the pattern unquoted', () => {
    deepStrictEqual(
      names(
        'Host good\n%%% garbage\n  FrobnicateTheWidget yes\nHost "quoted-name" plain',
      ),
      ['good', 'quoted-name', 'plain'],
    );
  });
```

Row 2 (`connect-picker-model.test.ts`):

```ts
  it('F-2201 AC-2: a host defined in the user file and in the system file is listed twice', () => {
    const model = pickerModel(
      {
        hosts: [
          {name: 'both', file: '/home/dev/.ssh/config'},
          {name: 'both', file: '/etc/ssh/ssh_config'},
        ],
      },
      '',
    );
    deepStrictEqual(
      'items' in model
        ? model.items
            .filter(item => item.kind === 'host')
            .map(item => item.label)
        : model,
      ['both', 'both'],
    );
  });
```

Row 3 (`connect-ports.test.ts`). The fixture's `translate` wraps a text in `<…>`:

```ts
  it('F-2304 AC-29: a typed user@host or user@host:port target is titled by the host alone', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      [
        options.startTitle(decoded('alex@dev')),
        options.startTitle(decoded('alex@dev:22')),
      ],
      ['<Setting up SSH Host dev>', '<Setting up SSH Host dev>'],
    );
  });
```

## 3. Done when

- the three rows are in and pass;
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm dupes` and `pnpm coverage` pass;
- `pnpm check-coverage` passes.

If a row fails as written, don't change the expected value. Stop and report the actual value on the issue.

## 4. Review

PR title `tests: unit rows for the host list and the typed target's title (card coverage-07, #142)`. themis or triton
reviews.
