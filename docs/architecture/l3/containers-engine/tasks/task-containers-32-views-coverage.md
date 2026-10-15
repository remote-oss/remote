# Task card containers-32: the coverage lines of the Dev Containers views, by slice, the rest deferred

Issue: #966. Milestone 0.4. Size: S–M. Builder: `task:claude`.

**Design:** athena's ruling on #960 (card 3; §1's "Out of 0.4" and §3's deferral rule), `brief-release-1.md` as
amended in #961.

Sources: F-0901 (remote-oss/remote-containers#76), F-0902 (#80, `spec:draft`), F-0903 (#94), F-0906 (#72), each
§13.

## 1. The change

1. **`tools/spec-acceptance-criteria.ts`:** add `F-0901`, `F-0902`, `F-0903` and `F-0906` to
   `CONTAINERS_RELEASE_ONE_FEATURES`, in id order. The doc comment names #960 for them. In
   `spec-acceptance-criteria.test.ts`, the count row goes from 24 to 28 and also checks the four ids.
2. **`docs/architecture/catalogue/coverage-containers-r1.tsv`:** add one line per criterion of the four features, in
   the file's id order (check-coverage refuses a line out of order), each `<id>\ttodo\t`. Take the ids with the tool's
   own reader, never by hand: `acceptanceCriteriaOf(body, feature)` over `gh issue view <n> -R
   remote-oss/remote-containers --json body`. Don't run `seed-coverage containers-r1`: it rewrites the whole file and
   loses its tags.
3. **Deferrals:** a criterion whose Given, When or Then needs something §2 lists becomes `deferred` with that row's
   reason, verbatim. When more than one row applies, take the first in the table's order. Every other criterion stays
   `todo`: slices A, B and C tag theirs as they're built (containers-29 to 31, then B and C).

## 2. The deferral reasons (#960's form: `containers 0.4: <F-xxxx or component> later`)

| Needs | Reason |
|---|---|
| an attached container, an Attach command, recorded or recent folders, Remove Recent Folder | `containers 0.4: C12 attach later` |
| a Kubernetes pod window | `containers 0.4: Kubernetes later` |
| Docker Compose | `containers 0.4: Compose later` |
| a container volume: Clone Repository in Container Volume, a volume-backed dev container | `containers 0.4: C13 volumes later` |
| the Dev Volumes view, or a count of three views (F-0906 AC-2, AC-18) | `containers 0.4: F-0904 later` |
| Clean Up, or a count of three title actions (F-0901 BR-6, AC-3) | `containers 0.4: F-0905 later` |
| New Dev Container or Try a Sample | `containers 0.4: F-0806 later` |
| Reopen Folder Locally, in WSL, in SSH or in Tunnel from the view (placements `#11`–`#14`), including AC-5's menu | `containers 0.4: F-0406 later` |
| an SSH-hosted engine or `needsSSHCredentials` (WELCOME#1) | `containers 0.4: F-1302 later` |
| `hideConnectCommands` set | `containers 0.4: F-0504 BR-8 later` |
| a Windows or macOS UI, or WSL | `containers 0.4: Windows, WSL and macOS later` |
| a Recovery Container (F-0901 6.20) | `containers 0.4: F-0410 recovery container later` |
| Open Container Configuration File, or Attach in New Window on the Details toolbar (F-0903) | `containers 0.4: F-0903 toolbar commands later` |

Nothing else is deferred. F-0901 AC-22 (S419 and S436 never seen) stays `todo`: containers-29's model can prove it
with a unit row.

**F-0902 is `spec:draft`.** Add its lines now. If its review renumbers or removes criteria, the slice B card re-reads
them with the same reader and fixes the lines.

## 3. Rows and gates

- check-coverage passes, and its counts move by exactly the new lines.
- The test row of §1.1.
- Every deferred line's reason is a row of §2, character for character. Add a test in `check-coverage.test.ts` only
  if the scope gains a `deferredReasons` list. Don't add one: the containers scope has none, and #960 doesn't ask
  for it.

PR title: `catalogue: the coverage lines of the Dev Containers views, by slice, the rest deferred (card
containers-32, #966)`. Request athena only. The PR body lists the deferred criteria grouped by reason, so athena can
check them against #960 in one read.

**Open rows (stop and report on #966):**
1. A criterion fits none of §2's rows and none of slices A, B or C.
2. A criterion of F-0906 needs a remote-explorer change (#960 §2 says there's none).
