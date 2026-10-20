# Task card containers-83: gate-row-11 counts F-0402's notification from the window's open as one of the Cancel's (F-0106 AC-7)

Containers release 1. Size: S. Builder: `task:local` (selene). Everything is decided here. If what you find differs,
comment on this issue and stop.

`F-0106 AC-3, AC-4, AC-7, F-0401 AC-21 (gate-row-11)` (`tests/acceptance/containers-trust/gate.test.ts`, in the
`containers-trust` launch) failed on CI (dispatch 39408493001, X64) and on ARM64 (dispatch 39356471804). After each
Cancel it expects `notifications: []`, and it read `['Folder contains a Dev Container configuration file. Reopen
folder to develop in a container (learn more).']`.

## 1. The cause (daedalus, reading main)

That notification is F-0402's. `open/reopen-notification.ts` `offerReopen` shows it when a folder with a configuration
opens, trusted or not. It doesn't come from the Cancel. Core purges an info toast after about 10 s, so whether the
row still sees it after the Cancel depends only on how fast the row got there. F-0106 AC-7 asks that the Cancel adds
no notification ("left completely unchanged … no notification").

## 2. The change (the row only)

- Read the toasts right **before** each Cancel (`notifications(name)`), as `before`, beside `whileOpen`.
- After the Cancel, keep the 2 s wait, then assert that the toasts are those of `before` less any that core purged
  meanwhile: `after.notifications` is a subset of `before`. In the row's one assertion, put
  `after.notifications.every(text => before.includes(text))` in the `after` object as `noNewNotification: true` in
  place of `notifications: []`.
- Nothing else of the row changes.

## 3. Done when

`node tools/acceptance.ts --editor vscodium --launches containers-trust` passes the row (paste the summary line), and
all gates pass. PR title: `tests: gate-row-11 checks that the Cancel adds no notification (card containers-83,
#1256)`. Request athena only.
