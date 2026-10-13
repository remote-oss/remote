# Task card tooling-23: rows that pin the acceptance switch to exactly 1

Issue: #525. Why: triton's review of #511 (tooling-18). `progressFor` and `channelPortFor` turn the harness on only
when `REMOTE_OSS_ACCEPTANCE` is `1` (`switchedOn`), but no row pins that value. Changing `switchedOn` to `!== undefined`
passes all 70 rows of `scripted-adapters.test.ts`. (`adaptersFor`'s own check is pinned already by its row with the
value `0`.) Builder: selene. **Depends on tooling-18 (PR #511) merged.**

## 1. The change

One file, `packages/remote-ssh/test/unit/scripted-adapters.test.ts`: two rows, each just before an existing row of its
`describe`. The diff below was applied on #511's branch (`feature/tooling-18`) and run: 72 rows pass. With `switchedOn`
changed to `environment[SWITCH] !== undefined`, exactly these two fail, which is the point. Apply it exactly; no
source file changes:

```diff
diff --git a/packages/remote-ssh/test/unit/scripted-adapters.test.ts b/packages/remote-ssh/test/unit/scripted-adapters.test.ts
index a6b4f5c..63f7e63 100644
--- a/packages/remote-ssh/test/unit/scripted-adapters.test.ts
+++ b/packages/remote-ssh/test/unit/scripted-adapters.test.ts
@@ -726,6 +726,21 @@ describe('progressFor (card tooling-18)', () => {
     );
   });
 
+  it('D-85: with the switch at any value but 1 it is the real port itself', () => {
+    const real = new NotingProgress();
+    strictEqual(
+      progressFor(
+        {
+          REMOTE_OSS_ACCEPTANCE: 'yes',
+          REMOTE_OSS_ACCEPTANCE_RECORD: RECORD_FILE,
+        },
+        real,
+        new AppendedFiles(),
+      ),
+      real,
+    );
+  });
+
   it('D-85: with the switch on and no record file it is the real port itself', () => {
     const real = new NotingProgress();
     strictEqual(
@@ -882,6 +897,18 @@ describe('channelPortFor (card tooling-18)', () => {
     );
   });
 
+  it('D-85: with the switch at any value but 1 it is the real port itself', () => {
+    const real = new NotingChannels();
+    strictEqual(
+      channelPortFor(
+        {REMOTE_OSS_ACCEPTANCE: 'yes', REMOTE_OSS_ACCEPTANCE_LOG: LOG_FILE},
+        real,
+        new AppendedFiles(),
+      ),
+      real,
+    );
+  });
+
   it('D-85: with the switch on and an empty log variable it is the real port itself', () => {
     const real = new NotingChannels();
     strictEqual(
```

## 2. Done when

- the two rows pass on main after #511, and `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit` and
  `pnpm coverage` pass;
- the PR body says you checked that both rows fail with `switchedOn` changed to `!== undefined` (and then changed it
  back).

## 3. Review

PR title `tests: rows that pin the acceptance switch to exactly 1 (card tooling-23)`. triton reviews.
