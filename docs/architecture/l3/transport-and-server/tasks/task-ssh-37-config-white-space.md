# Task card ssh-37: a white-space-only remote.SSH.configFile is invalid, not unset (remote-ssh#30)

Issue: #513. Why: metis's follow-up answer on `remote-oss/remote-ssh#30` (2026-10-12): `remote.SSH.configFile` is
used **as written, never trimmed**, in all three uses (the host list, `ssh -F`, Open SSH Configuration File). Only
`''` means unset. A value of white space only is non-empty and not absolute, so it is **invalid**: no hosts, the connect
fails before ssh starts, and the command rejects it. F-2201 BR-3 and F-2203 7.E3 say so, and athena's contracts on
main (ef0664a, S2) state the rule. Today `configFilePath` maps white space only to `unset`, and the file picker shows
the default rows for it. Builder: selene.

## 1. The change

Two source lines and their comments, five rows rewritten, and two rows added. The diff below was applied on main
and run: lib-ssh and remote-ssh's unit tests pass (2567 rows), and lint and typecheck are clean. Apply it exactly.

| File | Change |
|---|---|
| `packages/lib-ssh/src/config/files.ts` | `configFilePath`: only `''` is `unset` |
| `packages/remote-ssh/src/config/file-choice.ts` | `buildFileChoice`: any non-empty value is the configured row, as written |
| `packages/lib-ssh/test/unit/files.test.ts` | the white-space row expects `invalid`; new rows for a leading space (`invalid`) and a trailing space (a file named with it); `filesInEffect('   ')` gives no file |
| `packages/lib-ssh/test/unit/hosts.test.ts` | white space only offers no hosts |
| `packages/lib-ssh/test/unit/invocation.test.ts` | white space only is refused, as any value that isn't absolute |
| `packages/remote-ssh/test/unit/file-choice.test.ts` | white space only is offered as written, as the configured row |

The callers need no change: `locateClientStep` and `buildInvocation` already fail on `invalid`, and Open SSH
Configuration File already rejects it.

```diff
diff --git a/packages/lib-ssh/src/config/files.ts b/packages/lib-ssh/src/config/files.ts
index 17f6caa..a5e1183 100644
--- a/packages/lib-ssh/src/config/files.ts
+++ b/packages/lib-ssh/src/config/files.ts
@@ -64,7 +64,7 @@ export function expandHome(
 
 /** What `remote.SSH.configFile` names: no file, an absolute file, or an invalid value. */
 export type ConfigFileSetting =
-  | {kind: 'unset'} // '' or only white space
+  | {kind: 'unset'} // ''
   | {kind: 'file'; path: string} // absolute after `~` expansion
   | {kind: 'invalid'; value: string}; // anything else, `value` as written
 
@@ -74,7 +74,7 @@ export function configFilePath(
   homeFolder: string,
   platform: ClientPlatform,
 ): ConfigFileSetting {
-  if (value.trim() === '') {
+  if (value === '') {
     return {kind: 'unset'};
   }
   const expanded = expandHome(value, homeFolder, platform);
diff --git a/packages/lib-ssh/test/unit/files.test.ts b/packages/lib-ssh/test/unit/files.test.ts
index 3cec5ac..3aaf5b8 100644
--- a/packages/lib-ssh/test/unit/files.test.ts
+++ b/packages/lib-ssh/test/unit/files.test.ts
@@ -41,8 +41,25 @@ describe('configFilePath (the one check of the configured file)', () => {
     deepStrictEqual(configFilePath('', '/h', 'linux'), {kind: 'unset'});
   });
 
-  it('F-2201.BR-3: a value of white space only is unset', () => {
-    deepStrictEqual(configFilePath('  ', '/h', 'linux'), {kind: 'unset'});
+  it('F-2201.BR-3: a value of white space only is invalid, as written', () => {
+    deepStrictEqual(configFilePath('  ', '/h', 'linux'), {
+      kind: 'invalid',
+      value: '  ',
+    });
+  });
+
+  it('F-2201.BR-3: a leading space makes the value not absolute, so invalid', () => {
+    deepStrictEqual(configFilePath(' /etc/x', '/h', 'linux'), {
+      kind: 'invalid',
+      value: ' /etc/x',
+    });
+  });
+
+  it('F-2201.BR-3: a trailing space is kept: the file is named with it', () => {
+    deepStrictEqual(configFilePath('/etc/x ', '/h', 'linux'), {
+      kind: 'file',
+      path: '/etc/x ',
+    });
   });
 
   it('F-2201.BR-3: /etc/x on Linux is a file', () => {
@@ -195,10 +212,10 @@ describe('filesInEffect (the configuration files in reading order)', () => {
     });
   }
 
-  it('F-2201.BR-2: a configured setting of white space only is unset, so the default files apply', () => {
+  it('F-2201.BR-3: a configured setting of white space only is invalid, so no file is in effect', () => {
     deepStrictEqual(
       filesInEffect('   ', {...LINUX}, userAndSystem(USER_TEXT)),
-      EXPECTED_FILES,
+      [],
     );
   });
 
diff --git a/packages/lib-ssh/test/unit/hosts.test.ts b/packages/lib-ssh/test/unit/hosts.test.ts
index 18f9f46..f369c83 100644
--- a/packages/lib-ssh/test/unit/hosts.test.ts
+++ b/packages/lib-ssh/test/unit/hosts.test.ts
@@ -586,10 +586,10 @@ describe('listHosts (the host entries of the files in effect)', () => {
     });
   }
 
-  it('F-2201.BR-2: a configured setting of white space only is unset, so the files in effect list', () => {
+  it('F-2201.BR-3: a configured setting of white space only is invalid, so it offers no hosts', () => {
     deepStrictEqual(
       names(undefined, [[SYSTEM_FILE, 'Host y']], {configFile: '   '}),
-      ['y'],
+      [],
     );
   });
 
diff --git a/packages/lib-ssh/test/unit/invocation.test.ts b/packages/lib-ssh/test/unit/invocation.test.ts
index 26837e3..5550ddd 100644
--- a/packages/lib-ssh/test/unit/invocation.test.ts
+++ b/packages/lib-ssh/test/unit/invocation.test.ts
@@ -305,11 +305,10 @@ describe('buildInvocation (the arguments of one ssh or scp run)', () => {
     });
   }
 
-  it('F-2201.BR-2: a spaces-only configFile is unset, so no -F', () => {
-    strictEqual(
-      flagPair(buildInvocation(makeRequest({configFile: '   '})), '-F').length,
-      0,
-    );
+  it('F-2201.BR-3: a spaces-only configFile is not absolute, so it is refused', () => {
+    throws(() => buildInvocation(makeRequest({configFile: '   '})), {
+      message: 'remote.SSH.configFile is not absolute',
+    });
   });
 
   it('S2: buildInvocation refuses a configFile that is not absolute', () => {
diff --git a/packages/remote-ssh/src/config/file-choice.ts b/packages/remote-ssh/src/config/file-choice.ts
index c8a2743..012de9e 100644
--- a/packages/remote-ssh/src/config/file-choice.ts
+++ b/packages/remote-ssh/src/config/file-choice.ts
@@ -8,7 +8,7 @@ import type {StringRef} from '../connect/picker-model.ts';
 
 /** The input the picker model reads. */
 export interface FileChoiceInput {
-  /** `remote.SSH.configFile` as written; `''` or whitespace only means unset. */
+  /** `remote.SSH.configFile` as written; only `''` means unset. */
   configFile: string;
   /** The absolute user file, e.g. /home/u/.ssh/config. */
   userFile: string;
@@ -53,7 +53,7 @@ const HELP_ITEM: FileChoiceItem = {
  * rows. With one: the value exactly as written, untrimmed and unexpanded, then the settings and help rows.
  */
 export function buildFileChoice(input: FileChoiceInput): FileChoice {
-  if (input.configFile.trim() !== '') {
+  if (input.configFile !== '') {
     return {
       placeholder: EDIT_PLACEHOLDER,
       items: [
diff --git a/packages/remote-ssh/test/unit/file-choice.test.ts b/packages/remote-ssh/test/unit/file-choice.test.ts
index dd4c612..2ea76c4 100644
--- a/packages/remote-ssh/test/unit/file-choice.test.ts
+++ b/packages/remote-ssh/test/unit/file-choice.test.ts
@@ -59,18 +59,14 @@ describe('buildFileChoice (the rows of the configuration file picker)', () => {
     );
   });
 
-  it('F-2203.BR-1: a whitespace-only configured file is the same as unset', () => {
+  it('F-2203.BR-1: a whitespace-only setting is set, so the picker offers it as written', () => {
     deepStrictEqual(
       buildFileChoice({
         configFile: '   ',
         userFile: '/home/u/.ssh/config',
         systemFile: '/etc/ssh/ssh_config',
-      }),
-      buildFileChoice({
-        configFile: '',
-        userFile: '/home/u/.ssh/config',
-        systemFile: '/etc/ssh/ssh_config',
-      }),
+      }).items[0],
+      {kind: 'file', label: '   ', role: 'configured'},
     );
   });
 
```

## 2. Done when

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm dupes` and `pnpm coverage` pass, and
  the changed files are at 100/100/100. The packages' totals are what main measures, within the gate's half point of
  each ratchet (selene, 2026-10-13: lib-ssh 99.8/98.92/99.66, remote-ssh 100/99.77/100, the same with and without
  this change);
- `pnpm check-coverage` passes.

## 3. Review

PR title `lib-ssh, remote-ssh: a white-space-only remote.SSH.configFile is invalid (card ssh-37, remote-ssh#30)`.
themis or triton reviews.
