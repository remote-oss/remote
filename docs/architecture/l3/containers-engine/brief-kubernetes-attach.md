# Brief: Attach to a Kubernetes container (group 12)

Owner: athena (architect). Plan: #1807 group 12. Specs:
- remote-oss/remote-containers#110 (F-0604 Attach to Kubernetes containers, `spec:reviewed`);
- F-0604's halves of F-0106 (#46: the attach-family warning and forced trust), F-0602 AC-11, AC-12 (S230 in a pod window)
  and F-1202 6.8 (Test Connection in a pod window);
- the r1 `later (the attach, Kubernetes and Apple families)` lines that are about pods.

Decisions: R-26, R-27, R-31, R-79, ADR-0010, ADR-0013, `brief-attach.md` (C12, which this follows),
`brief-remote-ssh-engines.md` (a pod listed from an SSH window), F-1403. The Apple family (F-0605) is the Apple group's.

## 1. What it is

C12's attach with `kubectl` in Docker's place. It's a new family, `k8s-container`, with no Docker anywhere (§2 of the
spec). Most of C12 is reused:
- the attach-family warning (F-0106; BR-11: one warning for both attach commands);
- the new-window open (BR-6);
- the label formatter;
- C10's connect tail (lib-server's install, the window tunnel);
- C8's dialogs (BR-9: a failure past the listing is F-0601's S033 and its recovery picker).

## 2. `kubectl` (a C2-like host, `engine/kubectl-host.ts`)

- **One program host** spawns `kubectl` with argv only, no shell, and reads `-o json` (a documented form, ADR-0010).
- **Its environment** is the user's login-shell environment, probed once per window (BR-12), the same probe C10 runs
  for the env (`connect/remote-environment.ts`'s shell probe on the client). So a `kubectl` on the login `PATH` is
  found even when the editor's own `PATH` lacks it.
- **In an SSH window** (BR-19) the host runs through the outer exec server (`brief-remote-ssh-engines.md` §1), after the
  same probe on the SSH host. That half comes with part B's cards.
- **The context and namespace** are the kubeconfig's current ones at pick time (BR-2). Afterwards they're the window's
  own (§3).

## 3. The command, the pickers, the payload

- **The commands:**
  - `remote-containers.attachToK8sContainer` (Palette, BR-1's `when`);
  - `remote-containers.attachToK8sContainerFromViewlet`, Palette `false`, with its one `view/item/context` placement on
    the Kubernetes Tools explorer's pod rows (§3.3). It's a menu contribution only: we build no tree, and the partner
    extension may be absent (F-1404).
- **The listing** (BR-2, BR-3, BR-15, BR-16, BR-18):
  - **What it shows:** `kubectl get pods` in the current context and namespace, sorted by name, with no phase filter.
  - **Pickers:** the pod picker (label: the pod; description: the namespace), then, for two or more containers, S312
    "Select container" in spec order, `spec.containers` only (BR-4, BR-5, BR-13, BR-17).
  - **Escape** anywhere ends it with nothing open (BR-14).
- **The wait:**
  - **The progress:** the pod picker opens **busy** at once and fills when `kubectl` answers, and Escape cancels the
    listing. That's BR-15's preferred route under decision F-0604 E6: "a progress indication with Cancel".
  - **A second invocation while one is pending** reuses that picker, so there are never two windows (BR-18, required
    and preferred).
- **Ruling `(ruling-NNNN-kubectl-bound)`, R-79 against the room decision "F-0604 kubectl hang":**
  - **What we do instead:** that decision applies no timeout beyond `kubectl`'s own. We bound every wait of ours, so:
    - the listing ends at **180 s** as the pod-listing failure, S173 (7.E1);
    - the attach step keeps C10's existing connect bounds.
  - **Why 180 s:** it's above the 160 s `kubectl` itself took to give up in the spec's measurement, so a slow but
    working cluster isn't cut. Only a `kubectl` that never returns (the broken-`user: {}` kubeconfig) changes outcome:
    a dialog instead of an endless wait.
  - **The paperwork:** the unit rows carry the label, and release notes gain the Deviations entry.
- **The payload** `k8s-container+<hex>`:
  - **The members:** the kube context, the namespace, the pod name, the container name and the image reference shown
    in the label (BR-22), with F-0604's member names reused verbatim (F-1406, D-14) as the card reads them from its §8.
  - **Pinned:** a reload or reconnect uses them whatever the kubeconfig says then.
- **The label:** "{container name} in {pod name} ({image reference})" (BR-8), through the same formatter as attach.

## 4. The connect (C10's `k8s-container` family)

- **The exec channel:** `kubectl exec -i --context <c> -n <ns> <pod> -c <container> -- sh -c '<prelude>'`, with the same
  `HostChannel` contract as C11 (`contracts.md` §1). Its dialer runs the relay script on the installed server's `node`
  the same way.
- **Everything runs as the container's own user** (BR-21). There's no root step and no BR-13 preparation (BR-20). The
  server goes in that user's home.
- **No `devcontainer.metadata` merge** (BR-10). `set-up` isn't run at all: there's no Docker container id for the CLI to
  take.
- **Trust:** `trusted: true` (F-0106 BR-13, pod windows).
- **Losing the pod** (BR-23): core's reconnect path, then S033 on a reload. Retry reaches any pod now under that name.
- **No shutdown stop:** a pod window registers nothing with C9, since a pod isn't ours to stop.
- **Personalization** (`brief-personalization.md`): the relay host runs through the same `kubectl exec -i`. Phase E and
  P apply as each spec says for pod windows. Where a spec is silent, they apply as for attach.

## 5. In a pod window

- **F-0602's by-name command** shows S230 (AC-11, AC-12). No attach configuration file applies to a pod.
- **F-1202 Test Connection** runs the full test (6.8): the container round trips go through `kubectl exec`, and the host
  ones through C2's host shell.
- **F-0104's three log commands** work as in any window (AC-16).

## 6. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-0604 (36), r2 `todo` | this brief |
| the pod halves of F-0106, F-0602 AC-11 and AC-12, F-1202 6.8, F-0104 AC-16 and AC-16b | this brief |
| the r1 `later (the attach, Kubernetes and Apple families)` lines about pods (F-0101, F-0201, F-0501, F-0502, F-0504) | this brief; the card splits off the Apple ones to the Apple group |
| the SSH-window half (BR-19) | `brief-remote-ssh-engines.md`'s cards |

**Suggested cards** (daedalus):
1. **`kubectl`'s host and the listing:** §2, §3. Rows:
   - unit rows for the sort, the container order, the filters, the bound and the second invocation;
   - acceptance rows on the lab's cluster.
2. **The connect:** §4 and the label. Rows: F-0604's attach criteria, BR-20 to BR-23.
3. **The pod-window lines:** §5.

**Fixture** (proteus): a `kind` cluster in the lab, reached through a kubeconfig of the run's own (never the person's
`~/.kube`, as the SSH host fixture of #2098). It holds:
- a single-container pod and a multi-container pod with init containers;
- a pod as root and one with `runAsUser`;
- a `Pending` pod.
