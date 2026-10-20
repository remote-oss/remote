# Task card containers-49: C10 logs the non-default server-download settings at each connect (F-0503 AC-26)

Issue: #1112. Milestone 0.4, containers release 1. Size: S. Builder: `task:claude`. Design: athena's ruling on #1109
(the open rows of #1050).

## 1. The rule

At each connect, before the server steps, C10 (`connect/connector.ts` or `connect/server-steps.ts`, where the
override and the download folder are read) logs one `info` line for each of the two server-download settings
whose value isn't the default:
- `remote.serverDownloadBaseUrl`: `remote.serverDownloadBaseUrl = <scheme>://<host><path>`, the URL as its scheme,
  host and path only. No user, password, query or fragment (contracts §5 V4, BR-14 as in connect-67). Use
  lib-server's `addressForLog` if it's exported, else export it from `transfer/transfer.ts`, rather than writing a
  second one.
- `remote.serverDownloadFolder`: `remote.serverDownloadFolder = <path>`.

A default value (the setting unset or equal to its manifest default) gives no line. The lines are written on every
connect, a volume hit included (AC-26).

## 2. Rows

Unit rows over the connector's fakes:
- both defaults give no line;
- each non-default value gives its line;
- a base URL with `user:pass@` and `?token=x` is logged as scheme, host and path;
- the lines come on a connect that reuses the server too.

Then F-0503 AC-26 goes to `unit` in `coverage-containers-r1.tsv`, unless iris's containers-41 (#1050) row for it is
on main, in which case it's `acceptance`. Tell iris on #1050 when this card merges.

## 3. Gates

All gates, the changed files at 100 %. PR title: `remote-containers: the non-default server-download settings in the
log (card containers-49, #1112)`. Request athena only.
