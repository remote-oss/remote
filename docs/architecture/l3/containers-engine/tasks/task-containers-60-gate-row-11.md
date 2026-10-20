# Task card containers-60: gate-row-11 leaves the discovery notification out of "nothing else shows" (red on main)

Issue: #1161. Milestone 0.4, containers release 1. Size: XS. Builder: `task:local` (selene). A test fix, no product change.
Found by iris on clean main while running #1160's trust launch: `gate-row-11` fails because one extra notification is
in its list.

## 1. Why the row is wrong, not the product

`tests/acceptance/containers-trust/gate.test.ts`, row `F-0106 AC-3, AC-4, AC-7, F-0401 AC-21 (gate-row-11)`, expects
`notifications: []` after each Cancel. The extra toast is the discovery notification, "Folder contains a Dev
Container configuration file. Reopen folder to develop in a container…". F-0301 (remote-oss/remote-containers#20)
5.0 step 2 says "Discovery and the notification of step 2 work in Restricted Mode", so it rightly shows in this
untrusted folder. It's there before the Reopen attempt, which is what "Cancel leaves everything as it was" means. The
row predates discovery, and whether the toast is still on screen when the row reads it depends on timing. #1147 added
`containers-trust/configuration.test.ts` to the same launch, which changes that timing.

## 2. The change (gate.test.ts only)

1. Next to `TRUST_QUESTION`, add:

   ```ts
   /** The start of the discovery notification, which F-0301 5.0 step 2 shows in Restricted Mode as well. */
   const DISCOVERY = 'Folder contains a Dev Container configuration file.';
   ```

   If the file already imports or defines the same text under another name, use that instead and don't add a
   second constant.
2. In gate-row-11, change `notifications: await notifications(name),` in `after` to:

   ```ts
               // The discovery notification shows before the attempt, in Restricted Mode too: it isn't the attempt's.
               notifications: (await notifications(name)).filter(
                 text => !text.startsWith(DISCOVERY),
               ),
   ```

3. Nothing else in the row changes: `expectedDeclined.after.notifications` stays `[]`.
4. Search `gate.test.ts` for any other `notifications: await notifications(` whose expected value is `[]` in a
   folder that has a configuration and is untrusted. Apply the same filter there, and list each row you changed in
   the PR. Don't change a row whose expected list isn't `[]`.

## 3. Done when

- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-trust` passes **twice in a row**.
  Paste both summary lines in the PR.
- o5 (`F-0403 AC-17 (o5)`) flaked once for iris and passed on re-run. If it fails in either of your runs, paste its
  failure in the PR, but don't change it in this card.
- `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js tests/acceptance/containers-trust/gate.test.ts`
  and `npx prettier --check` on it are clean.
- PR title: `tests: gate-row-11 leaves the discovery notification out of what Cancel must not show (card containers-60, #1161)`.
  Request athena only.
