# Task card coverage-26: unit rows for 21 slice-1 criteria, and four moved out

Issue: #724. Release 0.2, **gating** (the 0.2 gap analysis: these criteria are `todo`, and a unit row decides each).
Size: S. Builder: selene. The patch of section 3 was written and run on main b0334ea (2026-10-14): every row passes, and
typecheck, lint, format and dupes are clean.

The criteria the D-65 recorded cases cover (F-2301, F-2304, F-2306, F-2601) are not in this card: they are tagged
`recorded` once the replay passes.

## 1. What each criterion gets

| Criterion | Row (file: name, short) | What core or another card decides |
|---|---|---|
| F-2102 AC-2, AC-3, AC-23 | `skeleton.test.ts`: new. The Kill command's palette `when` is `config.remote.SSH.useLocalServer && !opensshremotes.standingDown`, its title and category, and untrusted workspaces supported | the palette listing, and core's `config.` keys following each change without a reload ([oss] `src/vs/platform/contextkey/browser/contextKeyService.ts`, `ConfigAwareContextValuesContainer`) |
| F-2403 AC-18 | `skeleton.test.ts`: new. `useCurlAndWgetConfigurationFiles` is a boolean, `false`, `application`, with the description of §3.2 | the Settings editor's checkbox |
| F-2501 AC-28 | `failure-presenter.test.ts`: new. Escape calls only More Actions, never Retry or Close Remote; `skeleton.test.ts`: new. The two indicator entries have no condition but the stand-down | the dialog, and the indicator's "Close Remote Connection" and "Reload Window" |
| F-2501 AC-15 | lib-authority `resolver-host.test.ts`: renamed. A failed first resolve reaches core as a handled `NotAvailable` after the presenter | core suppressing its notification for a handled error |
| F-2501 AC-21 | `editor-operations.test.ts`: renamed. Close Remote runs `workbench.action.remote.close` | core reusing the window ([oss] `src/vs/workbench/contrib/remote/browser/remoteIndicator.ts`: `openWindow({forceReuseWindow: true, remoteAuthority: null})`) |
| F-2101 AC-2, AC-17 | `locate-step.test.ts`: new. Each candidate runs once with `-V` alone and exactly the editor environment | stdin a pipe: lib-ssh `node-spawner.ts` (`stdio: ['pipe', 'pipe', 'pipe']`) |
| F-2101 AC-17, AC-18 | lib-ssh `session.test.ts`: new. The connection keeps the editor's HOME, PATH and SSH_AUTH_SOCK, an empty SSH_AUTH_SOCK as it is, under our askpass variables | |
| F-2101 AC-27 | `locate-step.test.ts`: renamed. The lookup runs only `-V` and `ssh -G`; its dependencies have no port that writes | |
| F-2101 AC-30 | `terminal-connection-step.test.ts`: new. Terminal mode adds no variable, so no SSH_ASKPASS; `login-terminal.test.ts`: renamed (the home folder); lib-ssh `askpass-environment.test.ts`: renamed (shared mode sets SSH_ASKPASS) | |
| F-2202 AC-1 | `connect-picker-model.test.ts`: new. `listHosts` of the AC's file through `pickerModel`: five label-only host rows in file order, then the fixed rows | |
| F-2202 AC-19 | `connect-picker-model.test.ts`: new. 2000 two-name `Host` lines and 200 `Match host` blocks give 4200 rows in file order, within a second of a two-host file | |
| F-2305 AC-2, AC-7 | `editor-adapters.test.ts`: renamed. The masked input every masked question goes through (`prompt-surface.ts`) is `password` and `ignoreFocusOut` | |
| F-3902 AC-2 | lib-product `resolve.test.ts`: new. A VSCodium `product.json` without the template resolves at `builtInTable` to the address its own template gives | |
| F-3902 AC-4 | lib-product `resolve.test.ts`: new. An override with the six placeholders on an alpine arm64 host | the Alpine name from musl: `server-steps.test.ts` "names the host an Alpine one when it runs musl" |
| F-3902 AC-10, AC-11 | lib-server `plan.test.ts`: two renamed (the `cliServers` and the `bin` reuse); `server-steps.test.ts`: renamed (a reuse on a client with licence lines asks); `connect.test.ts`: changed (a reuse plan runs the gate, then the start, and no transfer) | |
| F-3902 AC-13 | lib-server `licence-gate.test.ts`: renamed (it cited AC-11, but a stored acceptance that isn't asked again is AC-13); `server-steps.test.ts`: renamed (the flag); `editor-surfaces.test.ts`: renamed (the acceptance kept in the profile state) | |

**Fixture changes the rows need:**
- `locate.fixture.ts`'s `Seen` gains `environments`, which the spawner fills. Its three literals in `locate-step.test.ts`,
  `wiring.test.ts` and `connect-ports.test.ts` gain `environments: []`.
- `locate-step.test.ts`'s scenario gains `processEnvironment`.
- The failure presenter's button loop loses its `undefined` (Escape) case, which becomes the cited F-2501 AC-28 row.
  `String(button)` goes, because every button in the loop is a string now (lint's `no-unnecessary-type-conversion`).

## 2. Moved out, and why

| Criterion | New tag or state | Why |
|---|---|---|
| F-2202 AC-21, AC-32 | `deferred`, "build order slice 1: the Remotes view is remote-explorer's" | both are about the SSH group of the Remotes view, like AC-20, which has this tag. The picker half of AC-32 is BR-20's existing row |
| F-2401 AC-16, AC-17 | `deferred`, "D-86: only clearAllSessionHints of F-2605 is in 0.2" | the old-Linux link is placed only in the session record (BR-11) and in the warning that never shows (7.E11). Nothing writes a session record in 0.2: `hint-store.ts` has the key and the clear command, and no recorder |
| F-2101 AC-21 | stays `todo`: **defect** | see section 5 |
| F-2501 AC-4 | stays `todo`: **question** | see section 5 |
| F-2501 AC-34 | stays `todo`: **product gap** | see section 5 |

## 3. The patch

Test files only. Apply it exactly (`git apply`), then make the catalogue change of section 4 and run the checks of
section 6.

```diff
diff --git a/packages/lib-authority/test/unit/resolver-host.test.ts b/packages/lib-authority/test/unit/resolver-host.test.ts
index f956064..6e8816c 100644
--- a/packages/lib-authority/test/unit/resolver-host.test.ts
+++ b/packages/lib-authority/test/unit/resolver-host.test.ts
@@ -574,7 +574,7 @@ describe('the resolver host: a failure (contracts section 3.2)', () => {
     deepStrictEqual(context.presenter.seen, [FAILURE]);
   });
 
-  it('F-2601: a presenter that handled it makes the error handled', async () => {
+  it('F-2501 AC-15: a first resolve that fails reaches core as a handled error once the presenter has shown it, so core adds no notification', async () => {
     const context = await setup();
     context.connector.answer = FAILURE;
     deepStrictEqual(
diff --git a/packages/lib-product/test/unit/resolve.test.ts b/packages/lib-product/test/unit/resolve.test.ts
index d407c78..706a930 100644
--- a/packages/lib-product/test/unit/resolve.test.ts
+++ b/packages/lib-product/test/unit/resolve.test.ts
@@ -1,8 +1,11 @@
 import {deepStrictEqual} from 'node:assert';
+import {readFileSync} from 'node:fs';
+import path from 'node:path';
 import {
   type ArchiveResolution,
   OVERRIDE_POLICIES,
   type OverridePolicy,
+  readProfile,
   resolveServerArchive,
 } from '../../src/index.ts';
 import {fixtureProfile} from './fixture.ts';
@@ -75,6 +78,60 @@ describe('resolveServerArchive', () => {
       );
     });
 
+    it('F-3902 AC-2: a VSCodium product.json without the template takes the built-in codium entry, which names the archive of its own template', () => {
+      const fields = JSON.parse(
+        readFileSync(
+          path.join(
+            import.meta.dirname,
+            '..',
+            'fixtures',
+            'vscodium-reduced.json',
+          ),
+          'utf8',
+        ),
+      ) as Record<string, unknown>;
+      delete fields.serverDownloadUrlTemplate;
+      const reading = readProfile(JSON.stringify(fields));
+      if (reading.kind !== 'profile') {
+        throw new Error(`the fixture is unreadable: ${reading.reason}`);
+      }
+      const removed = resolveServerArchive(
+        reading.profile,
+        LINUX_X64,
+        SSH_POLICY,
+      );
+      const own = resolveServerArchive(
+        fixtureProfile('vscodium-reduced'),
+        LINUX_X64,
+        SSH_POLICY,
+      );
+      deepStrictEqual(
+        [
+          removed.kind === 'resolved' ? removed.step : removed.kind,
+          resolvedAddress(removed),
+        ],
+        ['builtInTable', resolvedAddress(own)],
+      );
+    });
+
+    it('F-3902 AC-4: an override with the six placeholders names alpine, arm64, the version, the commit, the quality and an empty release', () => {
+      deepStrictEqual(
+        resolvedAddress(
+          resolveServerArchive(
+            fixtureProfile('vscodium-reduced'),
+            {operatingSystem: 'alpine', architecture: 'arm64'},
+            SSH_POLICY,
+            {
+              value:
+                'http://downloads.example.invalid/x?os=${os}&arch=${arch}&version=${version}&commit=${commit}&quality=${quality}&release=${release}',
+              layer: 'defaultProfileUser',
+            },
+          ),
+        ),
+        'http://downloads.example.invalid/x?os=alpine&arch=arm64&version=1.135.06055&commit=1a46a584&quality=stable&release=',
+      );
+    });
+
     it('gives the insiders entry its own repository', () => {
       deepStrictEqual(
         resolvedAddress(
diff --git a/packages/lib-server/test/unit/licence-gate.test.ts b/packages/lib-server/test/unit/licence-gate.test.ts
index c4f50ad..31dd06e 100644
--- a/packages/lib-server/test/unit/licence-gate.test.ts
+++ b/packages/lib-server/test/unit/licence-gate.test.ts
@@ -236,7 +236,7 @@ describe('ensureAccepted (V6)', () => {
     ]);
   });
 
-  it('F-3902.AC-11: a stored acceptance is not asked again', async () => {
+  it('F-3902.AC-13: a stored acceptance is not asked again', async () => {
     const store = new MemoryStore();
     await gate(LICENSED, store, new ScriptedModal('accept'));
     const modal = new ScriptedModal('cancel');
diff --git a/packages/lib-server/test/unit/plan.test.ts b/packages/lib-server/test/unit/plan.test.ts
index 0cc77e2..66809f7 100644
--- a/packages/lib-server/test/unit/plan.test.ts
+++ b/packages/lib-server/test/unit/plan.test.ts
@@ -141,7 +141,7 @@ describe('install planner (card server-04 table)', () => {
     );
   });
 
-  it('an existing bin layout with the plan commit and source noSource -> reuse of that layout (reuse before source)', () => {
+  it('F-3902 AC-11: an existing bin layout with the plan commit and source noSource -> reuse of that layout (reuse before source)', () => {
     const layout = binLayout('abc');
     deepStrictEqual(
       plan(input({facts: {...facts, existingLayouts: [layout]}})),
@@ -158,7 +158,7 @@ describe('install planner (card server-04 table)', () => {
     );
   });
 
-  it('an existing cliServers layout with the commit and no bin layout -> reuse of the cliServers layout', () => {
+  it('F-3902 AC-10: an existing cliServers layout with the commit and no bin layout -> reuse of the cliServers layout', () => {
     const layout = cliLayout('abc');
     const result = plan(input({facts: {...facts, existingLayouts: [layout]}}));
     const planOf = asPlan(result);
diff --git a/packages/lib-ssh/test/unit/askpass-environment.test.ts b/packages/lib-ssh/test/unit/askpass-environment.test.ts
index 4bf10dc..606661a 100644
--- a/packages/lib-ssh/test/unit/askpass-environment.test.ts
+++ b/packages/lib-ssh/test/unit/askpass-environment.test.ts
@@ -8,7 +8,7 @@ const REQUEST = {
 };
 
 describe('askpass environment', () => {
-  it('points ssh at our launcher and forces its use, with the endpoint and the nonce', () => {
+  it('F-2101 AC-30: points ssh at our launcher and forces its use, with the endpoint and the nonce', () => {
     deepStrictEqual(askpassEnvironment({...REQUEST, external: false}), {
       SSH_ASKPASS: '/run/rh-askpass/rh-askpass-0123456789abcdef',
       SSH_ASKPASS_REQUIRE: 'force',
diff --git a/packages/lib-ssh/test/unit/session.test.ts b/packages/lib-ssh/test/unit/session.test.ts
index 3658e02..1bae26d 100644
--- a/packages/lib-ssh/test/unit/session.test.ts
+++ b/packages/lib-ssh/test/unit/session.test.ts
@@ -58,6 +58,18 @@ describe('S3 session spawner', () => {
       );
     });
 
+    it("F-2101 AC-17, AC-18: the connection keeps the editor's HOME, PATH and SSH_AUTH_SOCK, an empty SSH_AUTH_SOCK as it is, under our askpass", () => {
+      const environment = sessionEnvironment(
+        {HOME: '/home/user', PATH: '/bin', SSH_AUTH_SOCK: ''},
+        {...INVOCATION, environment: {}},
+        {SSH_ASKPASS: '/ext/askpass.sh', SSH_ASKPASS_REQUIRE: 'force'},
+      );
+      deepStrictEqual(
+        [environment.HOME, environment.PATH, environment.SSH_AUTH_SOCK],
+        ['/home/user', '/bin', ''],
+      );
+    });
+
     it('leaves out an editor variable that has no value', () => {
       deepStrictEqual(
         sessionEnvironment(
diff --git a/packages/remote-ssh/test/unit/connect-picker-model.test.ts b/packages/remote-ssh/test/unit/connect-picker-model.test.ts
index 0180d86..8fc3e8e 100644
--- a/packages/remote-ssh/test/unit/connect-picker-model.test.ts
+++ b/packages/remote-ssh/test/unit/connect-picker-model.test.ts
@@ -1,5 +1,10 @@
 import {deepStrictEqual} from 'node:assert';
-import type {HostListResult} from 'lib-ssh';
+import {
+  type ClientLocations,
+  type ConfigFileReader,
+  type HostListResult,
+  listHosts,
+} from 'lib-ssh';
 import {
   outcomeOfPick,
   pickerModel,
@@ -17,6 +22,18 @@ const HOSTS: HostListResult = {
 
 const NONE: HostListResult = {hosts: []};
 
+/** A Linux client whose home is /home/dev. */
+const LINUX: ClientLocations = {homeFolder: '/home/dev', platform: 'linux'};
+
+/** The host listing of a client whose only configuration file is the user file with `text`. */
+function listingOf(text: string): HostListResult {
+  const reader: ConfigFileReader = {
+    readText: file => (file === '/home/dev/.ssh/config' ? text : undefined),
+    listFolder: () => undefined,
+  };
+  return listHosts('', LINUX, reader);
+}
+
 const ADD_LABEL: StringRef = {id: 'S167', values: ['$(plus)']};
 const CONF_LABEL: StringRef = {id: 'S024', values: []};
 
@@ -80,6 +97,51 @@ describe('pickerModel (card remote-ssh-02)', () => {
     );
   });
 
+  it('F-2202 AC-1: the names of the Host lines, in file order, are host rows with a label only, before the fixed rows', () => {
+    deepStrictEqual(
+      pickerModel(
+        listingOf('Host one\nHost two three   four\nHost last\n'),
+        '',
+      ),
+      expected([
+        ['one', false],
+        ['two', false],
+        ['three', false],
+        ['four', false],
+        ['last', false],
+      ]),
+    );
+  });
+
+  it('F-2202 AC-19: 4200 names reach the picker in file order, within a second of a two-host file', () => {
+    const text = [
+      ...[...Array(2000).keys()].map(
+        index => `Host a-${String(index)} b-${String(index)}`,
+      ),
+      ...[...Array(200).keys()].map(index => `Match host m-${String(index)}`),
+    ].join('\n');
+    function timed(text: string): {labels: unknown[]; took: number} {
+      const before = performance.now();
+      const model = pickerModel(listingOf(text), '');
+      return {
+        labels: 'items' in model ? model.items.map(item => item.label) : [],
+        took: performance.now() - before,
+      };
+    }
+    const large = timed(text);
+    const small = timed('Host x y');
+    deepStrictEqual(
+      [
+        large.labels.length,
+        large.labels[0],
+        large.labels[1],
+        large.labels[4199],
+        large.took - small.took < 1000,
+      ],
+      [4202, 'a-0', 'b-0', 'm-199', true],
+    );
+  });
+
   it('F-2301.AC-5: a listing with no hosts has only the fixed items', () => {
     deepStrictEqual(pickerModel(NONE, ''), expected([]));
   });
diff --git a/packages/remote-ssh/test/unit/connect-ports.test.ts b/packages/remote-ssh/test/unit/connect-ports.test.ts
index 85eaaa3..5de1aa7 100644
--- a/packages/remote-ssh/test/unit/connect-ports.test.ts
+++ b/packages/remote-ssh/test/unit/connect-ports.test.ts
@@ -84,7 +84,7 @@ function assemblyInputs(
   recorded: Recorded;
 } {
   const recorded: Recorded = {
-    spawned: {started: [], killed: []},
+    spawned: {started: [], killed: [], environments: []},
     helperStarts: [],
     revealed: 0,
     sink: new MemorySink(),
diff --git a/packages/remote-ssh/test/unit/connect.test.ts b/packages/remote-ssh/test/unit/connect.test.ts
index 7b563c9..c7e7e17 100644
--- a/packages/remote-ssh/test/unit/connect.test.ts
+++ b/packages/remote-ssh/test/unit/connect.test.ts
@@ -96,14 +96,19 @@ describe('the connect pipeline, when it works', () => {
     );
   });
 
-  it('skips the transfer when the plan reuses an installed server', async () => {
+  it('F-3902 AC-10, AC-11: a plan that reuses an installed server asks the gate before the start, and transfers nothing', async () => {
     const {recording, options} = setup();
     await connect(
       INPUT,
       steps(recording, {plan: () => ({plan: REUSE})}),
       options,
     );
-    deepStrictEqual(recording.calls.includes('transfer'), false);
+    deepStrictEqual(
+      recording.calls.filter(call =>
+        ['gate', 'transfer', 'start'].includes(call),
+      ),
+      ['gate', 'start'],
+    );
   });
 
   it('runs the pre-connection script on the first attempt only', async () => {
diff --git a/packages/remote-ssh/test/unit/editor-adapters.test.ts b/packages/remote-ssh/test/unit/editor-adapters.test.ts
index 4014b66..d1b65be 100644
--- a/packages/remote-ssh/test/unit/editor-adapters.test.ts
+++ b/packages/remote-ssh/test/unit/editor-adapters.test.ts
@@ -488,7 +488,7 @@ describe('promptEditorOf (the login questions, F-2305 and F-2306)', () => {
     deepStrictEqual([await result, fake.picks.length], [undefined, 0]);
   });
 
-  it('F-2306: the input is masked and stays open when the user looks away', () => {
+  it('F-2305 AC-2, AC-7: the input is masked and stays open when the user looks away (F-2306)', () => {
     const {inputBox} = typedInto(fakeEditor(() => undefined));
     deepStrictEqual(
       [
diff --git a/packages/remote-ssh/test/unit/editor-operations.test.ts b/packages/remote-ssh/test/unit/editor-operations.test.ts
index d67c295..a22f36a 100644
--- a/packages/remote-ssh/test/unit/editor-operations.test.ts
+++ b/packages/remote-ssh/test/unit/editor-operations.test.ts
@@ -49,7 +49,7 @@ describe("the editor's operations of the connect's surfaces", () => {
     deepStrictEqual(asked.commands, [['workbench.action.reloadWindow']]);
   });
 
-  it('F-2601: Close Remote closes the remote', async () => {
+  it("F-2501 AC-21: Close Remote runs core's workbench.action.remote.close, which makes the same window local", async () => {
     const {operations, asked} = operationsOver();
     await operations.closeRemote();
     deepStrictEqual(asked.commands, [['workbench.action.remote.close']]);
diff --git a/packages/remote-ssh/test/unit/editor-surfaces.test.ts b/packages/remote-ssh/test/unit/editor-surfaces.test.ts
index 69765be..de43b84 100644
--- a/packages/remote-ssh/test/unit/editor-surfaces.test.ts
+++ b/packages/remote-ssh/test/unit/editor-surfaces.test.ts
@@ -262,7 +262,7 @@ describe("the connect's surfaces over the editor", () => {
     ]);
   });
 
-  it('F-3902 rule 11: an acceptance is read from and kept in the profile state', async () => {
+  it('F-3902 AC-13: an acceptance is read from and kept in the profile state', async () => {
     const {surfaces, calls} = surfacesWith({accepted: {terms: true}});
     await surfaces.acceptances.accept('other');
     deepStrictEqual(
diff --git a/packages/remote-ssh/test/unit/failure-presenter.test.ts b/packages/remote-ssh/test/unit/failure-presenter.test.ts
index 91aac90..e5bef6a 100644
--- a/packages/remote-ssh/test/unit/failure-presenter.test.ts
+++ b/packages/remote-ssh/test/unit/failure-presenter.test.ts
@@ -175,9 +175,8 @@ describe('the failure presenter', () => {
     ['Retry', 'reload'],
     ['Close Remote', 'closeRemote'],
     ['More Actions...', 'moreActions channelClosed'],
-    [undefined, 'moreActions channelClosed'],
   ] as const) {
-    it(`F-2601: ${String(button)} calls ${called} once`, async () => {
+    it(`F-2601: ${button} calls ${called} once`, async () => {
       const {presenter, seen} = surroundings(() => Promise.resolve(button));
       await presenter.present(failedWith());
       await settle();
@@ -185,6 +184,13 @@ describe('the failure presenter', () => {
     });
   }
 
+  it('F-2501 AC-28: Escape on the failure dialog neither reloads nor closes the remote, and opens only the pick of More Actions', async () => {
+    const {presenter, seen} = surroundings(() => Promise.resolve(undefined));
+    await presenter.present(failedWith());
+    await settle();
+    deepStrictEqual(seen.calls, ['moreActions channelClosed']);
+  });
+
   it('contracts 3.2: a dialog that rejects leaves "handled" and no unhandled rejection', async () => {
     const {presenter, seen} = surroundings(() =>
       Promise.reject(new Error('the editor failed')),
diff --git a/packages/remote-ssh/test/unit/locate-step.test.ts b/packages/remote-ssh/test/unit/locate-step.test.ts
index c3fb4fd..d801793 100644
--- a/packages/remote-ssh/test/unit/locate-step.test.ts
+++ b/packages/remote-ssh/test/unit/locate-step.test.ts
@@ -34,6 +34,7 @@ interface Scenario {
   connectTimeout?: unknown;
   mode?: ConnectionMode;
   input?: ConnectInput;
+  processEnvironment?: Readonly<Record<string, string>>;
 }
 
 /** Runs the step once and gives its result, what it kept, what the spawner saw, and the log. */
@@ -47,7 +48,7 @@ async function located(scenario: Scenario = {}): Promise<{
   /** The lines at info level: the client search. */
   searched: string[];
 }> {
-  const seen: Seen = {started: [], killed: []};
+  const seen: Seen = {started: [], killed: [], environments: []};
   const state: ConnectState = {};
   const sink = new MemorySink();
   const step = locateClientStep({
@@ -66,7 +67,7 @@ async function located(scenario: Scenario = {}): Promise<{
       scenario.lookup ?? LOOKUP,
       seen,
     ),
-    processEnvironment: {},
+    processEnvironment: scenario.processEnvironment ?? {},
     checkMilliseconds: 20,
     state,
     logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
@@ -103,11 +104,34 @@ describe('the step that finds the ssh client', () => {
     });
   });
 
-  it('F-2101: the client is checked with -V, then the accepted one looks the host up', async () => {
+  it('F-2101 AC-27: the lookup runs only the check and ssh -G, and has no port that writes a setting, a state key or a file', async () => {
     const {seen} = await located();
     deepStrictEqual(seen.started, ['ssh -V', 'ssh -G -- dev']);
   });
 
+  it('F-2101 AC-2, AC-17: each candidate is started once, with -V alone and exactly the editor environment', async () => {
+    const editor = {
+      HOME: '/home/a',
+      PATH: '/usr/bin',
+      SSH_AUTH_SOCK: '/run/agent.sock',
+    };
+    const {seen} = await located({
+      checks: {
+        '/opt/other': {kind: 'exit', errorOutput: 'Dropbear', status: 0},
+        [SSH_PROGRAM]: OPENSSH,
+      },
+      settingValue: '/opt/other',
+      processEnvironment: editor,
+    });
+    deepStrictEqual(
+      [seen.started, seen.environments],
+      [
+        ['/opt/other -V', 'ssh -V', 'ssh -G -- dev'],
+        [editor, editor, editor],
+      ],
+    );
+  });
+
   it('F-2101: a banner on standard output is accepted too', async () => {
     const {state} = await located({
       checks: {[SSH_PROGRAM]: {kind: 'exit', output: 'OpenSSH_9.6', status: 0}},
diff --git a/packages/remote-ssh/test/unit/locate.fixture.ts b/packages/remote-ssh/test/unit/locate.fixture.ts
index cfcbc87..8b04561 100644
--- a/packages/remote-ssh/test/unit/locate.fixture.ts
+++ b/packages/remote-ssh/test/unit/locate.fixture.ts
@@ -20,6 +20,8 @@ export type Answer =
 export interface Seen {
   started: string[];
   killed: string[];
+  /** The environment of each run, in the order of `started`. */
+  environments: Array<Readonly<Record<string, string>>>;
 }
 
 /** A spawner whose programs answer `-V` from `checks` and `-G` with `lookup`. */
@@ -38,6 +40,7 @@ export function spawnerOf(
     seen.started.push(
       `${specification.program} ${specification.programArguments.join(' ')}`,
     );
+    seen.environments.push(specification.environment);
     function later(
       text: string | undefined,
       listener: (chunk: string) => void,
diff --git a/packages/remote-ssh/test/unit/login-terminal.test.ts b/packages/remote-ssh/test/unit/login-terminal.test.ts
index b1acd4c..a30cc44 100644
--- a/packages/remote-ssh/test/unit/login-terminal.test.ts
+++ b/packages/remote-ssh/test/unit/login-terminal.test.ts
@@ -107,7 +107,7 @@ function opened(reveal = false) {
 }
 
 describe('loginTerminalsOf (card ssh-18 table)', () => {
-  it('F-2308 §16: creates a hidden terminal in the home folder with the invocation', () => {
+  it('F-2101 AC-30: creates a hidden terminal in the home folder with the invocation (F-2308 §16)', () => {
     deepStrictEqual(opened().created, [
       {
         name: 'install',
diff --git a/packages/remote-ssh/test/unit/server-steps.test.ts b/packages/remote-ssh/test/unit/server-steps.test.ts
index 3839b3e..7d15994 100644
--- a/packages/remote-ssh/test/unit/server-steps.test.ts
+++ b/packages/remote-ssh/test/unit/server-steps.test.ts
@@ -614,7 +614,7 @@ describe('the server steps: gate', () => {
     );
   });
 
-  it('asks about a reused server of a product that lists licence lines, and clears it on accept', async () => {
+  it('F-3902 AC-10, AC-11: asks about a reused server of a product that lists licence lines, and clears it on accept', async () => {
     const asked: string[] = [];
     const steps = createServerSteps(
       dependencies({
@@ -707,7 +707,7 @@ describe('the server steps: transfer and start', () => {
     });
   });
 
-  it('starts the server with the licence flag only when the gate cleared it', async () => {
+  it('F-3902 AC-13: starts the server with the licence flag only when the gate cleared it', async () => {
     const steps = createServerSteps(dependencies());
     const withFlag = channelAnswering(STARTED);
     const without = channelAnswering(STARTED);
diff --git a/packages/remote-ssh/test/unit/skeleton.test.ts b/packages/remote-ssh/test/unit/skeleton.test.ts
index 03deafa..5773c52 100644
--- a/packages/remote-ssh/test/unit/skeleton.test.ts
+++ b/packages/remote-ssh/test/unit/skeleton.test.ts
@@ -783,7 +783,10 @@ describe('the manifest rows of slice 1', () => {
     contributes: {
       configuration: {properties: Record<string, Record<string, unknown>>};
       commands: Array<{command: string; title: string; category: string}>;
-      menus: Record<string, Array<{command: string; when?: string}>>;
+      menus: Record<
+        string,
+        Array<{command: string; when?: string; group?: string}>
+      >;
       keybindings?: Array<{command: string}>;
     };
   };
@@ -900,4 +903,77 @@ describe('the manifest rows of slice 1', () => {
       ['Remote-SSH', 'Connect to Host...', [], []],
     );
   });
+
+  it('F-2102 AC-2, AC-3, AC-23: the Kill command is in the palette exactly while remote.SSH.useLocalServer is true, in Restricted Mode too', () => {
+    const command = manifest.contributes.commands.find(
+      entry => entry.command === 'opensshremotes.cleanLocalServer',
+    );
+    deepStrictEqual(
+      [
+        command?.category,
+        resolved(command?.title),
+        manifest.contributes.menus.commandPalette
+          ?.filter(entry => entry.command === 'opensshremotes.cleanLocalServer')
+          .map(entry => entry.when),
+        manifest.capabilities.untrustedWorkspaces,
+      ],
+      [
+        'Remote-SSH',
+        'Kill Local Connection Server For Host...',
+        ['config.remote.SSH.useLocalServer && !opensshremotes.standingDown'],
+        {supported: true},
+      ],
+    );
+  });
+
+  it("F-2501 AC-28: a disconnected window's remote indicator offers Connect to Host... and then Connect Current Window to Host..., as every window that is not standing down", () => {
+    deepStrictEqual(
+      manifest.contributes.menus['statusBar/remoteIndicator']?.map(entry => {
+        const command = manifest.contributes.commands.find(
+          declared => declared.command === entry.command,
+        );
+        return [
+          entry.command,
+          entry.group,
+          entry.when,
+          command?.category,
+          resolved(command?.title),
+        ];
+      }),
+      [
+        [
+          'opensshremotes.openEmptyWindow',
+          'remote_20_ssh-remote_1general@1',
+          '!opensshremotes.standingDown',
+          'Remote-SSH',
+          'Connect to Host...',
+        ],
+        [
+          'opensshremotes.openEmptyWindowInCurrentWindow',
+          'remote_20_ssh-remote_1general@2',
+          '!opensshremotes.standingDown',
+          'Remote-SSH',
+          'Connect Current Window to Host...',
+        ],
+      ],
+    );
+  });
+
+  it('F-2403 AC-18: remote.SSH.useCurlAndWgetConfigurationFiles is a boolean, false by default, application scope, with the description of 3.2', () => {
+    const setting = properties['remote.SSH.useCurlAndWgetConfigurationFiles'];
+    deepStrictEqual(
+      [
+        setting?.type,
+        setting?.default,
+        setting?.scope,
+        resolved(setting?.markdownDescription),
+      ],
+      [
+        'boolean',
+        false,
+        'application',
+        "Respect configuration from remote environment's 'curlrc' and 'wgetrc' files (placed in their respective default locations).  Enabling this setting may be useful in certain cases (i.e: proxy configuration) but can interfere with this extension's operation. Setting may be ignored on platforms that do not support the necessary flags (i.e: busybox).",
+      ],
+    );
+  });
 });
diff --git a/packages/remote-ssh/test/unit/terminal-connection-step.test.ts b/packages/remote-ssh/test/unit/terminal-connection-step.test.ts
index 52e9814..15a2d78 100644
--- a/packages/remote-ssh/test/unit/terminal-connection-step.test.ts
+++ b/packages/remote-ssh/test/unit/terminal-connection-step.test.ts
@@ -188,6 +188,11 @@ describe('the connection in terminal mode (card connect-17 table)', () => {
     );
   });
 
+  it('F-2101 AC-30: the connection in terminal mode adds no variable to the editor environment, so no SSH_ASKPASS', async () => {
+    const {terminal} = await started(fixture());
+    deepStrictEqual(terminal.invocation.environment, {});
+  });
+
   it('F-2704 BR-1: the invocation runs sh without a terminal on the host', async () => {
     const {terminal} = await started(fixture());
     const invoked = terminal.invocation.arguments;
diff --git a/packages/remote-ssh/test/unit/wiring.test.ts b/packages/remote-ssh/test/unit/wiring.test.ts
index 71cfbf0..6c40e08 100644
--- a/packages/remote-ssh/test/unit/wiring.test.ts
+++ b/packages/remote-ssh/test/unit/wiring.test.ts
@@ -112,7 +112,7 @@ function portsOf(
   } = {},
 ): {ports: WiringPorts; seen: WiringSeen} {
   const seen: WiringSeen = {
-    spawned: {started: [], killed: []},
+    spawned: {started: [], killed: [], environments: []},
     acquires: [],
     logins: [],
     channels: [],
```

## 4. Catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, in the same PR. Change only the tag and reason columns of these
lines; they are all `todo` today.

- **To `unit`, with an empty reason:**
  - F-2101 AC-2, 18, 27, 30;
  - F-2102 AC-2, 3, 23;
  - F-2202 AC-1, 19;
  - F-2305 AC-2, 7;
  - F-2403 AC-18;
  - F-2501 AC-15, 21, 28;
  - F-3902 AC-2, 4, 10, 11, 13.
- **To `deferred`:**
  - F-2202 AC-21 and AC-32, with the reason `build order slice 1: the Remotes view is remote-explorer's`;
  - F-2401 AC-16 and AC-17, with the reason `D-86: only clearAllSessionHints of F-2605 is in 0.2`.

F-2101 AC-17 stays `todo` (athena, 2026-10-14). Its clause "SSH_ASKPASS_REQUIRE is not set" contradicts the
recorded adaptation (F-2309 BR-3) until the spec scopes it to the external askpass. The AC-17 rows are still built, and
the tag follows when the spec is republished. `node tools/check-coverage.ts` then prints `unit` 20 higher and
`deferred` 4 higher than main does before the change.

## 5. Not in this card

The lead has handled these:
- the S009 defect is connect-45 (#733);
- the `ELECTRON_RUN_AS_NODE` note is helper-04 (#734);
- athena deferred F-2501 AC-4 and AC-34 in the catalogue sweep (#706).

F-2101 AC-18: the rows prove that an empty SSH_AUTH_SOCK reaches ssh unchanged. That a key file then works is ssh's own
behaviour, and no acceptance row is added for it.

## 6. Gates and review

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm dupes`, `pnpm dead`, `pnpm check-coverage` (section 4's
counts), `pnpm test:unit`. Paste `check-coverage`'s counts in the PR, and section 5 in its body. PR title
`tests: unit rows for 21 slice-1 criteria, and four moved out (card coverage-26, #724)`. themis or triton reviews.
athena gives the tag check, including section 2 and section 5 items 2 to 4.

## 7. Open rows (stop and report on the issue)

1. The patch doesn't apply on the main you branch from. Report the hunk; don't rewrite it by hand.
2. A row fails. Report its output; don't change the expected value.
3. `check-coverage` reports a problem. Report it as printed.
