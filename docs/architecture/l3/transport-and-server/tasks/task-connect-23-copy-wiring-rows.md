# Task card connect-23: rows that pin the window copy's wiring (themis on #419)

Why: themis's three non-blocking findings on #419 (merged; the window's `scp` in its hidden login terminal, F-2405
AC-9). Three wirings in `connect-ports.ts` and `wiring.ts` pass with a wrong value, because no row reads them. Rows
only: no source change. Reviewing coder: `remote-coding-worker-1`.

1. The copier's `connectWait: () => channelRun.connectWait`. A fixed 1 s passes, because no row advances the clock
   while the copy terminal stays silent.
2. `attachQuestions` gets `channelRun.displayHost`. Another name passes, because no row makes the copy terminal ask.
3. `ChannelRun.connectWait` takes the **setting's** value when the host sets no `ConnectTimeout`. Only the host-value
   path has a row (the install terminal has both).

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/test/unit/connect-ports.test.ts` | the fixture changes and rows 1–2 (section 2, section 3) |
| `packages/remote-ssh/test/unit/wiring.test.ts` | row 3 |

No source file changes.

## 2. Fixture changes (`connect-ports.test.ts`)

- `assemblyInputs` returns its `FakeClock` as `clock` beside `surfaces`, `machine` and `recorded`. It is the clock
  whose `scheduler()` the machine already uses.
- `channelOver(written, prompts?)` takes an optional `PromptEditor`, given to the surfaces in place of
  `SILENT_PROMPTS`, and returns `clock` too. Its `connectWait` stays `{connectTimeoutSeconds: 15, fromHost: false,
  unboundedWaitSeconds: 600}` (a wait of 17 000 ms: 15 s plus the 2 s margin, `connectWaitMilliseconds`).
- A recording prompt editor for row 2: `pick` records `request.title` and resolves `undefined`; `maskedInput` resolves
  `undefined`; `translate` is the identity.

**Why a host-key question, not a password one:** a password question's placeholder names the `user@host` from ssh's
own text (`Enter password for alex@dev`, S066 over the question's last word, `lib-ssh` `prompts/classify.ts`), so it
cannot show which display host was given. The first-contact host-key question's title is S001 with `[displayHost,
fingerprint]`, so only it reads the display host.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| themis on #419 (1), F-2105 BR-3 | a copy started (`copyStarted`), the terminal silent; the clock advanced 16 999 ms | the copy has not settled |
| themis on #419 (1), F-2105 BR-3 | the same, advanced 17 000 ms | the copy settled with `timeout` |
| themis on #419 (2), F-2305 BR-2 | a copy started with the recording prompt editor; the terminal prints the first-contact block (`The authenticity of host 'dev (192.0.2.1)' can't be established.`, `ED25519 key fingerprint is SHA256:abc.`, `Are you sure you want to continue connecting (yes/no/[fingerprint])? `), then the clock advances 100 ms (the reader's pause) | the pick's title is S001's text with `dev` (the channel run's `displayHost`) and `SHA256:abc`, as `textOf` renders `{id: 'S001', values: ['dev', 'SHA256:abc']}` with the identity translator |
| themis on #419 (3), F-2105 BR-1 | `wiring.test.ts`: `channelRunOf('dev')` with the lookup's default options (no `connecttimeout`) and the setting `connectTimeout: 30` | `connectWait` is `{connectTimeoutSeconds: 30, fromHost: false, unboundedWaitSeconds: 600}` |

For row 3, `channelRunOf` needs the setting: give it an optional `connectTimeout` that it passes to `portsOf`. "Not
settled" is checked by racing the copy's promise against `settled()`, as the file's other rows do.

Check each row with the mutation themis named: (1) a fixed `connectWait` of 1 s fails row 1's second line; (2)
`attachQuestions` with another name fails row 2; (3) `connectWait` built from `undefined` instead of the setting fails
row 3. Name the three mutations and their failures in the PR.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's ratchet (unchanged, rows only).

## 5. Gates and review

PR title `remote-ssh: rows that pin the window copy's wiring (card connect-23, themis on #419)`.

## 6. Open rows

None.
