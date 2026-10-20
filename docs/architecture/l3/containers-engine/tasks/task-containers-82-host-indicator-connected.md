# Task card containers-82: the host indicator still reads "Opening Remote..." after the window connected (F-0412 AC-16, F-0415 AC-15, AC-16)

Containers release 1. Size: M. Builder: `task:claude`. Three rows of the `containers` launch failed on the same
symptom. On CI they were in proteus's dispatch 39408493001, X64 (`gh-lab run 39408493001 -R remote-oss/remote --log`,
job `acceptance (vscodium, @containers)`). Locally, hestia measured the same on #1206 for o15. In each, the window is
connected (or its commands are done), but `statusItem(name, 'status.host').text` reads `Opening Remote...`:

| Row | File | Read | Expected |
|---|---|---|---|
| `F-0412 AC-16 (i16)` | `containers/image-build.test.ts:353` | the Dockerfile window's indicator, once the title already reads `[c52-title-build [Dev Container: Title Name]]` | `Dev Container: Title Name` |
| `F-0415 AC-16 (o16)` | `containers/lifecycle-order.test.ts:256` | `done.indicator`, after every command ended | `Dev Container: Wait Bad` |
| `F-0415 AC-15 (o15)` | `containers/lifecycle-order.test.ts` | the indicator after the host step (hestia) | `Dev Container: Wait Init` |

## 1. Find which it is

For each row, poll the indicator every 500 ms for 60 s after the point where the row reads it once now. Record when
it changes, with temporary logging you don't commit. Run the `containers` launch three times.
- **It changes late (a lag):** the rows read too early. Make each row wait for the indicator. Use a helper beside
  `statusItem` in `windows/renderer.ts`, `statusItemText(name, id, expected, milliseconds)`, which polls and returns
  the last text. Then assert. Name the bound in the helper's comment.
- **It never changes:** it's a product cause. The indicator is core's, from the resolved authority's label. Find
  with the [oss] lines what core waits for before it leaves "Opening Remote..." (`remoteIndicator` and the
  resolver's `ResolvedAuthority` and label), and what our resolve does differently in these cases (a Dockerfile
  build, a `waitFor`). Fix it in lib-authority or remote-containers, with a unit row, if the [oss] reading shows the
  fix. If the fix needs a contract change, comment here and stop.

## 2. Done when

The three rows pass in three local runs of `node tools/acceptance.ts --editor vscodium --launches containers` (paste
the summary lines), and all gates pass. PR title: `remote-containers: the host indicator reads the container once the
window is connected (card containers-82, #1255)`, or `tests: …` if the cause is the rows. Request athena only.
