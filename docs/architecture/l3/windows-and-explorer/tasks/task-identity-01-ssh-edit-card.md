# Task card identity-01: remote-ssh-edit manifest and README to the approved identity card (D-56)

Source: the user's approved identity card (relayed by the lead; the values below are complete for this package).
Reviewing coder: `remote-coding-worker-1`. ADR-0008 applies to every word.

## 1. Package and file boundary

`packages/remote-ssh-edit/package.json`, `package.nls.json` and the 14 `package.nls.<locale>.json` files, `README.md`,
and the existing test that checks nls key parity (adjust expected values only). Nothing else.

## 2. Values (exact)

| Field | Value |
|---|---|
| `displayName` | `Remote - SSH: Editing Configuration Files` (literal, unchanged) |
| `description` | `%description%` with the English text `Highlighting and completion for SSH config files, with every keyword documented as you type.` in `package.nls.json` and in every `package.nls.<locale>.json` (English in all 14 for now) |
| `keywords` | `["remote development", "remote", "ssh", "ssh config"]` |
| `repository` | `{ "type": "git", "url": "https://github.com/remote-oss/remote" }` |
| `bugs` | `{ "url": "https://github.com/remote-oss/remote/issues" }` |
| `homepage` | `https://github.com/remote-oss/remote#readme` |
| `license` | `MIT` (unchanged) |
| `icon` | absent (the family icon is a later card) |

README (replace the body, keep the maintainers' table at the end as it is), in this order and voice, no other
sections: (1) the display name as the title and the one-sentence description; (2) **What you get**: three bullets:
syntax highlighting for `ssh_config` files; keyword completion with the OpenSSH manual's wording for each keyword as
you type; a snippet that sets up a port forward; (3) **Get started**: three steps: install the extension; open
`~/.ssh/config` (or a file named `ssh.config`); start typing a keyword at the beginning of a line; (4)
**Requirements**: none beyond the editor; (5) **Settings and commands**: "This extension contributes no settings or
commands."; (6) **Part of remote-oss**: "Part of remote-oss, a collection of extensions that bring remote development
to Code - OSS and the editors built on it; install the Remote Development pack to get all of them."; (7) **Support**:
the issue tracker URL above; **License**: MIT, with the pointer to `ThirdPartyNotices.txt` for the OpenSSH manual
excerpts (keep the existing sentence).

## 3. Test table

| Given | Expected |
|---|---|
| `package.json` fields | exactly the values above (a test reads the manifest and compares each) |
| every `package.nls.*.json` | key `description` present with the English text; key parity holds (existing check) |
| README | contains the seven section headings in order and none of the words: reference, Microsoft, ms-vscode, clean-room, reimplement, spec, session, worker, lab (a test greps it) |
| the VSIX (`pnpm package`) | README inside equals the file; `icon` absent |

## 4. Rule for the worker

Tests first; change only the listed files; no other wording than given; full gate list.

## 5. Gates and review

PR title `remote-ssh-edit: identity card (card identity-01)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected. If the maintainers' table at the end of the README names any of the forbidden words, stop and report
rather than rewriting it.
