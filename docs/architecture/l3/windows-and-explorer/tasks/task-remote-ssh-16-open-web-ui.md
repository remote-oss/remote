# Task card remote-ssh-16: the Open Web UI command (#141 card E)

Why: athena's window-surfaces brief (#141), card E. F-2509: `opensshremotes.openWebUI` opens
`http://localhost:<port>/` in the user's browser, `<port>` being the TCP port of the server of the window's most
recent resolve (BR-5). Card C's `webUiUrl(port)` builds the address; nothing runs the command yet. Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/web-ui-command.ts` | new: `openWebUiHandler` (section 2) |
| `packages/remote-ssh/test/unit/web-ui-command.test.ts` | new |

Nothing else. No `vscode` import: the browser and the port come in as functions. The wiring (E6c, daedalus) passes
`vscode.env.openExternal` and the connector's current server port, and registers the handler under the generated
table's `openWebUI` entry.

## 2. Contract

```ts
import type {CommandHandler} from 'lib-identifiers';

/** What the command needs: the current server's port, and the browser. */
export interface WebUiPorts {
  /** The TCP port of the server of the window's current connection; `none` while no server is known. */
  serverPort(): number | 'none';
  /** Opens the address outside the editor. */
  openExternal(address: string): PromiseLike<boolean>;
}

/** The handler of Open Web UI: it opens the server's address when one is known, and nothing else. */
export function openWebUiHandler(ports: WebUiPorts): CommandHandler;
```

- `execute` ignores its arguments (F-2509 BR-5: arguments do not change the URL). It reads `serverPort()` once, builds
  `webUiUrl(port)` (card C) and, when there is an address, calls `openExternal(address)`.
- It returns a promise that resolves with `undefined` once `openExternal` has settled, and **never rejects**: a
  rejection of `openExternal` is caught and dropped (BR-6: the command shows nothing and logs nothing).
- With no port (`'none'`: no connection, socket mode, a reconnection in progress) it opens nothing and resolves
  `undefined` (AC-13, AC-19).
- No `isAvailable`: the generated entry's policy is `silent`, so out of context it does nothing either way (BR-8 and
  R-46 through lib-identifiers). The command reads the port at each run, so a new server after a reconnection gives
  the new port (AC-20).

`PromiseLike` is the type because the editor's `env.openExternal` returns a `Thenable`, which it fits; the package
has no `vscode` types outside `extension.ts`.

## 3. Test table

One assertion per `it`; the cite starts the name. `ports` is a fake that records the addresses opened and answers a
port the test sets.

| Cite | Given | Expected |
|---|---|---|
| F-2509 BR-5 | port `38123` | opened `['http://localhost:38123/']` |
| F-2509 BR-5 | port `38123`, called with arguments `('x', 1)` | opened `['http://localhost:38123/']` |
| F-2509 AC-19 | port `'none'` | opened `[]` |
| F-2509 AC-13 | port `'none'` | `execute()` resolves `undefined` |
| F-2509 AC-20 | port `38123`, run, then port `40001`, run | opened `['http://localhost:38123/', 'http://localhost:40001/']` |
| F-2509 BR-6 | `openExternal` rejects | `execute()` resolves `undefined` (no rejection) |
| F-2509 BR-6 | `openExternal` resolves `false` (the user declined) | `execute()` resolves `undefined` |
| F-2509 BR-6 | port `38123`, run twice | opened the same address twice |
| F-2509 BR-8 | the handler | has no `isAvailable` |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the Open Web UI command (card remote-ssh-16, #141 E)`.

## 6. Open rows

None.
