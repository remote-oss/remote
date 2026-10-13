# Task card tooling-22: the environment-argv rows wait for a release, not a clock

Issue: #505. Why: proteus's analysis of a flake in `tests/acceptance/server/environment-argv.test.ts` (PR #498, run
38320969913). The positive control's host child is `sh -c 'sleep 3; true' <token> &`, and the test polls with one
`docker exec` per 100 ms before it reads `ps`. On a saturated runner those calls take more than 3 s, the child has
exited by the time `ps` runs, and the row gets `[true, false, true]`. The same 3 s sleep lets the negative rows pass
vacuously under load: a script that has already ended leaks nothing. Builder: selene, who wrote the file in #460.
**High priority: it flakes PR runs.**

## 1. The change

Every script waits until the test **releases** it, instead of sleeping a fixed time. The release is a file on the
host, `/tmp/release-<id>`, that the test creates only after both `ps` reads. A bound of 60 s (600 tenths) ends a
script whose release was lost, so the run can't hang.

The diff below was applied on main 4dd35ae and run against the harness host (`pnpm build`, then `mocha --no-config
--extension ts --spec tests/acceptance/server/environment-argv.test.ts`): all 7 rows pass. With a 5 s delay inserted
before the `ps` reads, to stand in for a saturated runner, the positive control and the shared-session row still pass.
Apply it exactly; it's the whole change. One file, no row's name or assertion changes:

```diff
--- a/tests/acceptance/server/environment-argv.test.ts
+++ b/tests/acceptance/server/environment-argv.test.ts
@@ -11,13 +11,25 @@
 type HostChannel = SshHostChannel | SharedSessionChannel;
 type ScriptRequest = Parameters<HostChannel['runScript']>[0];
 
-const SLEEP_SECONDS = 3;
 const POLL_MILLISECONDS = 100;
 const POLL_ATTEMPTS = 100;
 
 /** How long the control's own child on the client lives: it must still run when the ps reads run. */
 const LOCAL_CHILD_SECONDS = 30;
 
+/** How many tenths of a second a script waits for its release before it ends anyway: a lost release can't hang the run. */
+const RELEASE_TENTHS = 600;
+
+/** Where on the host the test releases the script, once it has read the process lists. */
+function releaseFile(token: string): string {
+  return `/tmp/release-${fileId(token)}`;
+}
+
+/** The shell that waits on the host until the test releases the script, or the bound passes. */
+function waitForRelease(token: string): string {
+  return `n=0; while [ ! -e ${releaseFile(token)} ] && [ "$n" -lt ${String(RELEASE_TENTHS)} ]; do sleep 0.1; n=$((n + 1)); done`;
+}
+
 /** Where on the host the script writes the value it received. */
 function receivedFile(token: string): string {
   return `/tmp/got-${fileId(token)}`;
@@ -69,7 +81,7 @@
     };
   }
 
-  /** Runs the script and lists the processes of the host and of the client while the script sleeps. */
+  /** Runs the script and lists the processes of the host and of the client while the script waits, then releases it. */
   async function watched(
     channel: HostChannel,
     token: string,
@@ -97,6 +109,7 @@
     }
     const hostLines = host.onHost('ps', '-o', 'args').split('\n');
     const clientLines = listProcesses(['ps', '-eo', 'args']);
+    host.onHost('touch', releaseFile(token));
     const outcome = await running;
     return {
       hostLines,
@@ -110,13 +123,13 @@
     return `marker-${randomBytes(8).toString('hex')}`;
   }
 
-  function sleeping(token: string, readsInput: boolean): string {
-    return `${readsInput ? 'cat >/dev/null; ' : ''}echo "$MARKER" >${receivedFile(token)}; sleep ${String(SLEEP_SECONDS)}; true`;
+  function waiting(token: string, readsInput: boolean): string {
+    return `${readsInput ? 'cat >/dev/null; ' : ''}echo "$MARKER" >${receivedFile(token)}; ${waitForRelease(token)}; true`;
   }
 
-  /** The positive control's script: it reads its input, starts a child whose command line carries the marker, then sleeps for the reads. */
+  /** The positive control's script: it reads its input, starts a child whose command line carries the marker, then waits for the release. */
   function controlScript(token: string): string {
-    return `cat >/dev/null; echo "$MARKER" >${receivedFile(token)}; sh -c 'sleep ${String(SLEEP_SECONDS)}; true' ${token} & sleep ${String(SLEEP_SECONDS)}; true`;
+    return `cat >/dev/null; echo "$MARKER" >${receivedFile(token)}; sh -c '${waitForRelease(token)}; true' ${token} & ${waitForRelease(token)}; true`;
   }
 
   async function leaks(
@@ -134,7 +147,7 @@
       token,
       request(
         token,
-        sleeping(token, input.kind !== 'text' || input.text !== ''),
+        waiting(token, input.kind !== 'text' || input.text !== ''),
         input,
       ),
     );
```

## 2. Done when

- `pnpm lint`, `pnpm format:check` and `pnpm typecheck` pass;
- `pnpm test:acceptance:server` passes; paste its summary in the PR body;
- `git grep -n SLEEP_SECONDS tests/acceptance/server/environment-argv.test.ts` finds nothing.

## 3. Review

PR title `tests: environment-argv's scripts wait for a release, not a clock (card tooling-22)`. proteus reviews.
