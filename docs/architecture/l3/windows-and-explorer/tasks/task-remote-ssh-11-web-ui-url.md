# Task card remote-ssh-11: the Open Web UI address (#141 card C)

Why: `../brief-remote-ssh-window-surfaces.md`, card C. "Open Web UI" (`opensshremotes.openWebUI`, F-2509) opens the
server's port on `localhost`. Its address comes from lib-server's `serverPort`, which gives `number | 'none'` (none in
socket mode, in a local window, or while no server runs). This card is the pure part; card E is the command.
Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/window/web-ui.ts` | new |
| `packages/remote-ssh/test/unit/web-ui.test.ts` | new |

Nothing else. No `vscode` import.

## 2. Contract

```ts
/** The address Open Web UI opens for the server's port, or nothing when no port is known. */
export function webUiUrl(port: number | 'none'): string | undefined;
```

`http://localhost:<port>/` for a number, written with `String(port)`; `undefined` for `'none'` (F-2509 BR-5). The port is
lib-server's `serverPort` result taken as it is. It's never 0 or out of range from that source, and this function
doesn't check it.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2509 AC-20 | `webUiUrl(41263)` (the port of the window's current server, also a new one after a reconnection) | `'http://localhost:41263/'` |
| F-2509 BR-5 | `webUiUrl(8000)` | `'http://localhost:8000/'` (a trailing slash, no path) |
| F-2509 AC-19 | `webUiUrl('none')` (socket mode, nothing to open) | `undefined` |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the Open Web UI address (card remote-ssh-11, #141 card C)`; Part of #141.

## 6. Open rows

None.
