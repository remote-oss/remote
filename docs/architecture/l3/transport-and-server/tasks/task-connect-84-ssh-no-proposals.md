# Task card connect-84: genuine VS Code without the proposals shows the family's setup notice (F-2001 §3.4)

Issue: #1171. Release 0.2. Size: M. Builder: daedalus. Design: athena's ruling on #737 (2026-10-20). The spec question for an AC is on
remote-oss/remote-ssh#11 (F-2001). **Depends on #1165** (triton, tooling-51: the genuine launch's `client: 'vscode'`).

## 1. The finding

The dirty side ran our builds in genuine VS Code 1.139.1 with no API proposals enabled. They got only core's
"Extension Remote - SSH is required…" install offer, never F-2001 §3.4's setup notification (the family's F-3903
gate, which says the proposals must be enabled and how). The window stayed disconnected for over 6 minutes. On
VSCodium, the `no-proposals` launch shows the notice (its gate row).

## 2. Harness: an `ssh-no-proposals` launch

Model it on `containers-no-proposals` (`tools/acceptance-launches.ts`), on the genuine client of #1165:
`{...RENDERER_LAUNCH, label: 'ssh-no-proposals', suite: 'ssh-no-proposals', client: 'vscode', namedOnly: true, proposedApi: false}`.
It runs on the genuine CI job (proteus's) beside `genuine`, never on PRs. Add its unit rows next to genuine's.

## 3. Reproduce, then find the cause

Reproduce both ways, recording what the window shows, the extension's activation (the agent's readout) and our
log:
- **(a)** "Remote-SSH: Connect to Host..." on `harness` from a local window, which activates us in the local window;
- **(b)** a window opened directly on `ssh-remote+harness`, where activation would come from
  `onResolveRemoteAuthority:ssh-remote`.

Candidate causes to prove or rule out, each with the [oss] 1.139.1 lines:
1. In a stable build, core strips proposals an extension isn't allowed (`extensionsProposedApi.ts`). If it also
   drops or ignores `onResolveRemoteAuthority` for an extension without `resolvers`, we never activate in (b), and
   core's install offer is what's left.
2. In (a), the activation fails before the gate runs: a proposed member touched at load time, outside the probe's
   try/catch, so the notice never shows.
3. The notice is raised, but before core can show it (activation timing), or in the wrong window.

## 4. Fix and rows

- **Fix at the cause.** If (b) can't activate us at all without `resolvers`, the notice must come from somewhere we do
  activate. The candidates are the local window's activation in (a), and an activation event that needs no proposal
  in (b). Choosing that is a design question: report it to athena with the [oss] reading before coding, since it
  touches F-2001's activation events. If the cause is (2) or (3), fix it within the gate.
- **Rows** in `tests/acceptance/ssh-no-proposals/`, one for (a) and one for (b), wherever the fix makes the notice
  reachable:
  - the setup notification shows, with F-2001 §3.4's text and buttons;
  - our log has its line (the gate's "proposals missing" line, quoted from the code);
  - the window doesn't hang: whatever core then shows, the row ends within a bound.
- **Coverage:** an AC follows remote-ssh#11's answer. Until then the rows' names start the way the `no-proposals`
  gate row does (`contracts §3.4: F-3903 §5 rule 4, F-2001 §3.4: …`), not with a bare `F-2001`, which
  `check-coverage` refuses for an acceptance row without an AC. No coverage line changes.

## 5. Done when

`node tools/acceptance.ts --editor vscodium --launches ssh-no-proposals,no-proposals` passes, so VSCodium's gate row
stays green. All gates pass. PR title: `remote-ssh: genuine VS Code without the proposals shows the family's setup
notice (card connect-84, #1171)`. Request athena only.
