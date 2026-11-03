# Brief: remote Docker hosts (group 16, part A)

Owner: athena (architect). Plan: #1807 group 16. Spec: remote-oss/remote-containers#84 (F-0205 Docker hosts and contexts,
`spec:reviewed`): its remote-engine lines, plus F-0106 AC-16 and F-1101 AC-23.

Decisions: R-26, R-79, ADR-0010, ADR-0013, `brief-increment-2-rest.md` §4 (C2 alone owns the effective engine),
`contracts.md` §2, `brief-volumes.md` §2.3 (lib-helper's askpass relay).

**Part B**, a dev container opened from a Remote-SSH or tunnel window, is the next brief (`brief-remote-ssh-engines.md`).
It's F-1302's nested authorities over remote-ssh's exec server (R-89). Its lines are in §5 here. The tunnel half waits on
the user's F-8902 answers (Q5, Q8 to Q12).

## 1. What part A covers

A local window whose effective engine (C2) is reached over SSH:
- `DOCKER_HOST=ssh://…` from the environment or from `containers.environment`/`docker.environment`;
- `docker.host`;
- a context whose endpoint is `ssh://`.

The Docker CLI does the SSH itself, starting `ssh` as its transport. Nothing in our connect changes:
- C2's coordinate already picks the engine;
- the payload pins it (BR-19);
- the label carries the suffix (BR-16);
- binds and names are as for a local engine (BR-9).

The design is the **SSH questions** that `ssh` asks through the Docker CLI, and what a failure shows.

## 2. The SSH prompt relay (C2; BR-4, BR-14, BR-15)

- **Every `docker` C2 spawns** gets the askpass environment of lib-helper's relay, which is already C13's for git
  (`brief-volumes.md` §2.3):
  - `SSH_ASKPASS` is lib-helper's launcher, with `SSH_ASKPASS_REQUIRE=force` and the endpoint variables;
  - `DISPLAY` is left as the editor has it.

  That covers C3's CLI runs too: they spawn `docker` with C2's coordinate and environment.
- **The endpoint shows an input box per question**, in the editor's own input box: a password masked, a passphrase
  masked, a host-key question as text.
  - **The box** stays until answered, dismissed or blurred (BR-15). A user's answer isn't an R-79 wait: R-79 bounds
    our waits on programs, not on the person.
  - **Open questions:** lib-helper's `PromptBook` tracks the questions not yet answered, as for remote-ssh.
  - **Remembered answers:** BR-14's memory is new, ours, in C2, one per window, keyed by the exact question text.
    lib-helper's book keeps no answer.
    - It remembers each answer, or the decline, for the window's life.
    - It answers a repeated question without a box.
    - One answer serves all of one operation's SSH connections (BR-4).
  - **Secrets** (R-26): answers live only in that in-memory map, which is dropped with the window. They're never
    written, logged or put in an environment.
- **While an explicit command waits for an answer,** F-0202's "Starting Docker (show log)" (S332) shows beside the box
  (BR-10). A fast success shows nothing.
- **The passive check** (the Dev Containers view, BR-6) uses the same relay and the same book. It never shows a dialog,
  only BR-20's welcome content.

## 3. Failures (BR-5, BR-6, BR-8, BR-20)

- **An explicit command's failure** is classified by C2 from the Docker CLI's error output.
  - **"Permission denied"** in the SSH part gives STR:S056/STR:S225 with its buttons. Everything else gives F-0202's
    generic dialog.
  - **The reading:** BR-5's own rule, one literal test of ssh's documented "Permission denied" message in the error's
    SSH part (ADR-0010's documented forms), written in C2.
  - **No lib-ssh:** remote-containers still doesn't import lib-ssh (`components.md` §3, `brief-volumes.md` §2.3). Its
    classifier covers remote-ssh's many cases, and this needs one.
- **The passive view** shows BR-20's welcome content for its rule's cases, and never a dialog.
- **Nothing is remembered** of a failure (BR-8). The prompt book remembers answers, not failures (BR-14).

## 4. The rest of part A

- **F-0106 AC-16:** a remote daemon adds no confirmation of ours. That's a row only.
- **F-1101 AC-23** and the remote-engine rows of F-0205 run against the lab's SSH Docker host. That's a fixture for
  proteus: the harness's SSH host container with a Docker engine reachable as `ssh://` (the plan's "Docker on the SSH
  host").
- **BR-17** (the view follows a change of the configuration) is C2's engine-change event, already built.

## 5. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-0205's remote-engine lines (the r1 `later (remote engines)` F-0205 set, about 42), F-0106 AC-16, F-1101 AC-23 | this brief |
| the r1 `later (remote engines)` lines from a Remote-SSH window: F-0201 AC-13, AC-26, AC-37; F-0205 AC-35; F-0401 AC-16, AC-22; F-0403 AC-22; F-0405 AC-14, AC-15; F-0408 AC-22; F-0410 AC-20, AC-24, AC-25; F-0411 AC-20; F-0412 AC-35; F-0415 AC-22; F-0416 AC-19; F-0417 AC-29, AC-31, AC-32; F-0419 AC-38; F-0501 AC-28; F-0504 AC-19, AC-20, AC-21; F-0801 AC-12; F-1101 AC-29 | part B |
| F-1302's 25, and the SSH halves of `brief-attach.md`, `brief-views-and-commands.md`, `brief-reopen-locally.md` and `brief-personalization.md` | part B |
| tunnel windows: F-0401 AC-19, F-0409 AC-21, F-0410 AC-22 | part B's tunnel half, after the user's F-8902 answers |

**Suggested cards** (daedalus):
1. **The relay in C2:** §2, with unit rows for the environment, the book and the passive path.
2. **The failures:** §3, BR-5's rule in C2, with unit rows for "Permission denied" and the other classes.
3. **The fixture** (proteus): the SSH Docker host. Then the acceptance rows of §4 and F-0205's remote set.

## 6. Amendments carried by this PR (rulings of 2026-11-03)

1. **`brief-volumes.md` §2:** F-0701 6.3's GitHub item uses the built-in git-base API's `pickRemoteSource`, ruled on
   #1973:
   - looked up at use time and not in `extensionDependencies`;
   - with our S067 as the title and S068 as the placeholder;
   - S295 and S245 are git-base's own labels;
   - no item without git-base and a GitHub provider.
2. **`brief-compose.md` §6.2:** `(reading-1912-primary-in-use)`, ruled on #2053.
   - **The rule:** when another live connection is *connected to* the closing scope's primary container, the close
     kills nothing of its scope and remembers the scope's services as skipped.
   - **Pending:** F-0417 BR-7 says otherwise, and the question is with metis (remote-containers#133).
3. **`brief-explorer-increment-2.md` §7 row 2:** "after a window start with `collapseRecentFolders` on, every host row
   starts collapsed; Refresh keeps a row's current expansion (F-5104 BR-7 to BR-9)". Ruled on #1809.
