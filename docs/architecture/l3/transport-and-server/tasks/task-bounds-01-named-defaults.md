# Task card bounds-01: the connect's named defaults (#253 Q7)

Why: wiring the real connect (#140 part E) needs time and size bounds that had no source on main. The architect ruled
them on #253 Q7, spec values first. This card writes them as one named-defaults module per owning library, each value
with its basis, plus the pure function that turns the connect timeout into the two bounds that derive from it.
Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-server/src/policy/bounds.ts` | new: `CLIENT_DOWNLOAD_BOUNDS` |
| `packages/lib-forwarding/src/window-tunnel/bounds.ts` | new: `TUNNEL_WAIT_LIMITS`, `SOCKS_HANDSHAKE_MILLISECONDS` |
| `packages/remote-ssh/src/pipeline/bounds.ts` | new: `SERVER_BOUNDS`, `PRECONNECT_MILLISECONDS`, `CLIENT_CHECK_MILLISECONDS`, `HOST_ZERO_TIMEOUT_SECONDS`, `effectiveConnectTimeoutSeconds`, `connectWaitsFor` |
| each package's `src/index.ts` (lib-server, lib-forwarding) | export the new names |
| `packages/lib-server/test/unit/bounds.test.ts`, `packages/lib-forwarding/test/unit/bounds.test.ts`, `packages/remote-ssh/test/unit/bounds.test.ts` | new |

Nothing else. No module is changed to use the defaults yet; the wiring of part E imports them.

## 2. Contract

The values are athena's table on #253 Q7. **The code carries no feature, rule or issue ids** (ADR-0008's voice rule,
as `DISCARD_DEADLINE_MILLISECONDS` shows): each constant gets a JSDoc that says what the value bounds, in plain words.
The basis lives in the **test names**, which may carry ids (the Cite column below). The `//` notes in the block below
are for the card's reader only and are not copied into the code.

```ts
// lib-server: the client's download (DownloadBounds).
export const CLIENT_DOWNLOAD_BOUNDS: DownloadBounds = {
  deadlineMilliseconds: 30 * 60 * 1000,      // ruled on #253 Q7: a runaway ceiling; the stall bound catches hangs first
  stallMilliseconds: 60 * 1000,              // ruled on #253 Q7: no bytes for this long ends the download
  maximumBytes: 1024 * 1024 * 1024,          // ruled on #253 Q7: when no length is announced; a length governs otherwise
};

// lib-forwarding.
export const TUNNEL_WAIT_LIMITS: WaitLimits = {
  readyMilliseconds: 10 * 1000,              // F-2104 BR-10: fixed at 10 seconds
  retryMilliseconds: 100,                    // ruled on #253 Q7: the poll inside the ready window
  heldBytesMaximum: 16 * 1024 * 1024,        // ruled on #253 Q7: a client's early bytes before the host side opens
};
export const SOCKS_HANDSHAKE_MILLISECONDS = 10 * 1000;   // ruled on #253 Q7

// remote-ssh.
export const SERVER_BOUNDS: ServerBounds = {
  downloadSeconds: 30 * 60,                  // ruled on #253 Q7: F-2403 AC-24 needs at least 10 minutes
  readySeconds: 60,                          // ruled on #253 Q7: bounds a server that never listens
};
export const PRECONNECT_MILLISECONDS = 5 * 60 * 1000;   // ruled on #253 Q7: F-2108 AC-5 and AC-8
export const CLIENT_CHECK_MILLISECONDS = 30 * 1000;     // F-2101 AC-20
export const HOST_ZERO_TIMEOUT_SECONDS = 600;          // ruled on #253 Q7: a host's ConnectTimeout 0; provisional on F-2105 Q3

/** The connect timeout in seconds (F-2105 BR-1, BR-4). */
export function effectiveConnectTimeoutSeconds(hostValue: string | undefined, settingValue: unknown): number;
/** The probe's and the tunnel's waits for a connect timeout of `seconds`. */
export function connectWaitsFor(seconds: number): ConnectWaits;
```

`effectiveConnectTimeoutSeconds`:
- A host value (lib-ssh's effective `connectTimeout`, a string) that is a whole number of 1 or more wins.
- Else the setting `remote.SSH.connectTimeout` when it is a whole number of 1 or more.
- The setting's value `0` gives **0** (F-2105 BR-4: ssh gets no limit, and the extension's own wait becomes 2 s,
  which `connectWaitsFor(0)` adds).
- Anything else (absent, not a number, negative, fractional): **15** (F-2105 BR-1).
- A host value of `0`: **`HOST_ZERO_TIMEOUT_SECONDS`** (600). In OpenSSH, 0 waits on the system's TCP limit and
  doesn't fail fast, so a short wait would contradict the user (athena, #253 Q7). The **setting's** own 0 stays 0
  (2 s waits).

`connectWaitsFor(seconds)`:
- `probeMilliseconds`: `(seconds + 2) * 1000` (F-2401 7.E6 and AC-18; F-2105 BR-3).
- `tunnelMilliseconds`: `seconds * 1000`, or 2 000 when `seconds` is 0 (F-2304 7.E7, with BR-4's 2 s for 0).

Amended by connect-14 (E6a, accepted by athena): `ConnectWaits {probeMilliseconds, tunnelMilliseconds}` is declared
in `steps.ts` and is the value `locateClient` gives, since only the lookup knows the host's `ConnectTimeout`. The
pre-connection script runs before the lookup and has one bound for every host, so `PRECONNECT_MILLISECONDS` goes to
`ConnectOptions.preconnectMilliseconds` and `StepLimits` is gone.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| #253 Q7 | `CLIENT_DOWNLOAD_BOUNDS` | `{deadlineMilliseconds: 1800000, stallMilliseconds: 60000, maximumBytes: 1073741824}` |
| F-2104 BR-10 | `TUNNEL_WAIT_LIMITS` | `{readyMilliseconds: 10000, retryMilliseconds: 100, heldBytesMaximum: 16777216}` |
| #253 Q7 | `SOCKS_HANDSHAKE_MILLISECONDS` | `10000` |
| F-2403 AC-24 | `SERVER_BOUNDS` | `{downloadSeconds: 1800, readySeconds: 60}` |
| F-2108 AC-8 | `PRECONNECT_MILLISECONDS` | `300000` |
| F-2101 AC-20 | `CLIENT_CHECK_MILLISECONDS` | `30000` |
| F-2105 BR-1 | host `undefined`, setting `undefined` | `15` |
| F-2105 BR-1 | host `undefined`, setting `30` | `30` |
| F-2105 BR-1 | host `'45'`, setting `30` | `45` (the host's value wins) |
| F-2105 BR-4 | host `undefined`, setting `0` | `0` |
| F-2105 BR-4 | host `'0'`, setting `30` | `600` (the host's 0 gets the named ceiling) |
| F-2105 BR-4 | `connectWaitsFor(600)` | `{probeMilliseconds: 602000, tunnelMilliseconds: 600000}` |
| F-2105 BR-1 | host `undefined`, setting `-3` / `'x'` / `1.5` | `15` (one `it` each) |
| F-2105 BR-1 | host `'none'`-like text such as `'abc'`, setting `20` | `20` (a host value that's not a whole number is ignored) |
| F-2401 AC-18 | `connectWaitsFor(15)` | `{probeMilliseconds: 17000, tunnelMilliseconds: 15000}` |
| F-2105 BR-4 | `connectWaitsFor(0)` | `{probeMilliseconds: 2000, tunnelMilliseconds: 2000}` |

## 4. Rule for the worker

As card log-01; coverage at each package's 100/100/100 ratchet. The numbers are written as the products above
(`30 * 60 * 1000`), not as their results, so the unit is visible.

## 5. Gates and review

PR title `lib-server, lib-forwarding, remote-ssh: the connect's named defaults (card bounds-01, #253 Q7)`.

## 6. Open rows

None. A host `ConnectTimeout 0` was ruled on #253 Q7 (600 s, provisional on F-2105 Q3).
