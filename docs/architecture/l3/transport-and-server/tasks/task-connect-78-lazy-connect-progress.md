# Task card connect-78: a reload that reuses the connection shows no progress

Issue: #866. Gating: milestone 0.2. F-2304 PRE-2, §6.1 and BR-11; F-2501 §6.3 step 2 and AC-10. Size: M. Builder:
`task:claude`.

## 1. The defect

hestia measured it on #590 (coverage-19). A reload of a connected window, with the helper running and the record
stored, writes three `progress` lines: the start, `initializing` and `settingUpTunnel`. F-2304 §6.1 step 3 and F-2501
§6.3 step 2 say no progress notification is visible.

**The cause:**
- `packages/lib-authority/src/resolver/host.ts:289`: `connect()` calls `editor.progress.withProgress` before the
  connector runs, so every resolve opens the notification.
- The SSH pipeline sends `initializing` first thing (`pipeline/connect.ts:256`) and `settingUpTunnel` before every
  tunnel (`connect.ts:433`), a reuse included.

**The ruling** (athena, 2026-10-14, on this card) is lazy progress, which F-2304 BR-11 allows: "visible no later than
the first prompt of the connect, and within about 1.5 s of the resolve starting". The notification opens at the first
of:
1. a phase that is not **quiet**;
2. a prompt (the connector reports a phase that is not quiet before it shows one);
3. 1500 ms after the resolve started.

Once open, it stays open until the connect settles. The SSH connector sends its first `initializing` and every
`settingUpTunnel` quiet, so a healthy reuse opens nothing. A reuse that turns into work (the server is gone and
installs again) opens it at that work phase.

## 2. The contract (in this card PR)

`docs/architecture/l3/windows-and-explorer/contracts.md` §3.2 gains a paragraph after "Phases:", which athena
design-checks in this PR. The text is the one in this card PR's diff. In short:
- `ConnectPhase.quiet` sets the text without opening;
- a prompt is preceded by a phase that is not quiet;
- the fallback is 1500 ms (F-2304 BR-11);
- a family that never sends a quiet phase opens at its first phase, as today.

## 3. The fix

### 3.1 lib-authority

1. **`resolver/host.ts`, `ConnectPhase`:** add

   ```ts
   /** Sets the text the progress shows without opening it; a phase that is not quiet opens it (contracts §3.2). */
   quiet?: true;
   ```

2. **`ResolverEditor`:** add

   ```ts
   /** Calls `callback` once after `milliseconds`; the returned function cancels it. */
   startTimer(milliseconds: number, callback: () => void): () => void;
   ```

   - `vscode-resolver.ts` implements it with `setTimeout` and `clearTimeout`.
   - `testing/recording-resolver-editor.ts` records `timer <milliseconds>` and keeps the callbacks. It gains
     `fireTimers(): void` on `RecordingResolverEditor`, which calls each callback that is still pending once. Add
     `timer <milliseconds>` to the JSDoc's list of lines.
3. **`host.ts`, a module constant:** `/** F-2304 BR-11: the latest the progress opens after a resolve starts. */
   const PROGRESS_FALLBACK_MILLISECONDS = 1500;`.
4. **`host.ts`, `connect()`:** replace the eager `withProgress`. The connect runs outside the progress. The progress
   is a task that shows the last phase and waits for the connect to settle:

   ```ts
   async function connect(decoded: DecodedTarget, input: ConnectInput): Promise<Connected | Failed> {
     let shown: {title: string; details: boolean} | undefined;
     let report: ((title: string, details: boolean) => void) | undefined;
     let opened = false;
     let settle = (): void => undefined;
     const settled = new Promise<void>(resolve => {
       settle = resolve;
     });
     let stopTimer = (): void => undefined;
     function open(): void {
       if (opened) {
         return;
       }
       opened = true;
       stopTimer();
       void editor.progress.withProgress(
         {
           title: options.startTitle(decoded),
           cancellable: options.cancellable,
           onCancel: () => {
             connector.cancel();
           },
           onDetails: () => {
             connector.revealDetails();
           },
         },
         async update => {
           report = update;
           if (shown !== undefined) {
             update(shown.title, shown.details);
           }
           await settled;
         },
       );
     }
     stopTimer = editor.startTimer(PROGRESS_FALLBACK_MILLISECONDS, open);
     const stop = connector.onPhase(phase => {
       shown = {title: options.titleOf(phase, decoded), details: phase.details === true};
       if (report !== undefined) {
         report(shown.title, shown.details);
       } else if (phase.quiet !== true) {
         open();
       }
     });
     try {
       return await connector.connect(input);
     } finally {
       stop();
       stopTimer();
       settle();
     }
   }
   ```

   - A phase that arrives while the editor is still opening the notification only updates `shown`. The task reports
     the latest one when it starts.
   - The progress shows the start title alone until a phase is seen, as now.

### 3.2 lib-ssh

5. **`connection-server/client.ts`, `ConnectionNotice`:** add
   `/** This window's first request started the login: it was accepted without a wait. */ | {type: 'loginStarted'}`.
6. **`LoginWait.request()` (line 190):**
   `if (this.waited) { this.steps.owned(); } else { this.steps.started(); }`. Add the step
   `started: () => { this.notify({type: 'loginStarted'}); }` beside `owned` (line 341). The #253 Q12 rule holds: a
   window that owns the login from its first request is never told `loginOwned`.

### 3.3 remote-ssh

7. **`pipeline/connect.ts`:**
   - `PhaseEvent`'s first member becomes `{kind: 'initializing'; quiet?: true}`, and the union gains
     `{kind: 'promptShown'}`.
   - Line 256 sends `{kind: 'initializing', quiet: true}`.
8. **`pipeline/connector.ts`:**
   - `phaseOf` sets `quiet: true` for an `initializing` event that has it, and for every `settingUpTunnel`. The details
     rule is unchanged.
   - In `connect`, `onPhase` keeps the last phase it told (`let told: ConnectPhase = {name: 'initializing', details:
     true}`). On `promptShown` it tells that phase again without `quiet` (build it field by field, with no `quiet`
     key) and doesn't replace `told`.
   - `phaseOf` never receives `promptShown`.
9. **`pipeline/connection-step.ts:88`:** `notice.type === 'loginOwned' || notice.type === 'loginStarted'` sends
   `{kind: 'initializing'}`.
10. **`surfaces/prompt-surface.ts:156`:** add `case 'loginStarted':` to the cases that do nothing. Without it, the
    `default` takes every prompt down.
11. **`pipeline/wiring.ts`, `stepsOf`:**
    - Add a local `prompting` that sends `{kind: 'promptShown'}` through `onPhase`, then calls the wrapped function.
    - Use it for `createTermsSteps({...ports.terms, pickPlatform: prompting(ports.terms.pickPlatform)})` (line 300), and
      in `serverSteps` for `modal: {askUser: prompting(ports.server.modal.askUser.bind(ports.server.modal))}`.
    - These are the connect's only prompts that can come before a phase that isn't quiet. The login's prompts come
      after `loginStarted`, `loginOwned` or `waitingForOtherWindow`, and every reuse never prompts.
    - In `openConnection` (line 392), the terminal path sends `onPhase({kind: 'initializing'})` before it calls
      `terminalConnection`, because a terminal connect always logs in.

## 4. Rows

**lib-authority, `test/unit/resolver-host.test.ts`:**

| Name | Given | Expected |
|---|---|---|
| `F-2304 6.1: a connect whose phases are all quiet and that settles before the fallback opens no progress` | the fake connector tells `initializing` and `settingUpTunnel`, both `quiet`, then connects | no `progress` line; `timer 1500` recorded; `fireTimers()` after the resolve adds nothing |
| `F-2304 BR-11: the first phase that is not quiet opens the progress with its title` | a quiet `initializing`, then `downloading` | `progress <start title>`, `phase <downloading title>`, in that order |
| `F-2304 BR-11: a connect with no phase that opens it shows the progress at the fallback` | a quiet `initializing`, then `fireTimers()` before the connect settles | `progress <start title>`, `phase <initializing title> (details)` |
| `contracts §3.2: once open, a quiet phase updates the progress` | `downloading`, then a quiet `settingUpTunnel` | `phase <settingUpTunnel title>` after the open; one `progress` line |
| `contracts §3.2: the progress ends when the connect settles` | `downloading`, then the connect settles | the `withProgress` task has returned (the recording editor's `progress` promise is settled) |

The existing rows that expect a `progress` line (lines 455-500) now have the fake connector tell a phase that is not
quiet first. Rename none of them, and list them in the PR.

**lib-ssh, `test/unit/connection-client.test.ts`:**
- New: `F-2304 BR-11: a window whose first request is accepted is told the login started, once`. Expect
  `[{type: 'loginStarted'}]` among the notices.
- Extend the row at line 225 to filter `loginStarted` too. It still gives `[{type: 'waitingForOtherWindow'}, {type:
  'loginOwned'}]`.
- The row at line 240 (#253 Q12) stays.

**remote-ssh:**

| File | Name | Expected |
|---|---|---|
| `connection-step.test.ts` | rename line 368 to `F-2304 6.1: a lease on a helper already connected reports no stage` | as now |
| `connection-step.test.ts` | `F-2304 BR-11: a login this window starts is the initializing stage` (the lease emits `loginStarted`) | `[{kind: 'initializing'}]` |
| `connector.test.ts` | `F-2304 6.1: the pipeline's first initializing and the tunnel stage are quiet` | `{name: 'initializing', details: true, quiet: true}`, `{name: 'settingUpTunnel', quiet: true}` |
| `connector.test.ts` | `contracts §3.2: a prompt re-tells the last stage, not quiet` | after `downloading` and a quiet `settingUpTunnel`, `promptShown` tells `{name: 'settingUpTunnel'}` |
| `connect.test.ts` | the rows that list phases now start with `{kind: 'initializing', quiet: true}` | updated lists |
| `wiring.test.ts` | `F-2304 BR-11: the platform pick is preceded by a phase that opens the progress` | `promptShown` is recorded before the picker is asked |
| `wiring.test.ts` | `F-2304 BR-11: the licence question is preceded by a phase that opens the progress` | `promptShown` before `askUser` |
| `wiring.test.ts` | `F-2304 BR-11: a terminal connect reports initializing before the terminal starts` | `{kind: 'initializing'}` before the terminal step's first call |
| `prompt-surface.test.ts` | `contracts: the login-started notice leaves the prompts open` | an open prompt stays open after `loginStarted` |

**Acceptance:**
- hestia's AC-10 row, posted as a comment on #866, goes in `tests/acceptance/windows/` in the file that comment
  names. After the reload: no `maskedInput`, `pick` or `progress` line of `a1`, the same helper, `acceptedKeyLogins`
  unchanged, and `a1` connected within 10 s. It fails on main with 3 `progress` lines.
- The F-2304 rows that already pass (AC-1, AC-6, AC-11, AC-13, AC-14, AC-22, AC-27) must still pass in the full run.
  A fresh connect now opens at the login, not at the resolve start.

## 5. Gates and review

Run all gates and the VSCodium run. PR title: `lib-authority: the connect progress opens on work, a prompt or 1.5 s
(card connect-78, #866)`. Request athena only; hermes assigns the peer. Mark F-2501 AC-10 `acceptance` in
`docs/architecture/catalogue/coverage-slice1.tsv`.
