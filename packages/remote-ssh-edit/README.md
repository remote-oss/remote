# Remote - SSH: Editing Configuration Files

Language support for OpenSSH configuration files in VS Code-based editors:

- **Syntax highlighting** of keywords, values and comments.
- **Keyword completion**: at the start of a line, the list of `ssh_config` keywords, each with its documentation.
- **A tunnel template**: the "Configure tunnel" completion inserts a `Host` block with `HostName`, `LocalForward`
  and `User`, ready to fill in.
- **Editing aids**: line comments with `#`, bracket matching and auto-closing, indentation after a `Host` line.

It applies to `~/.ssh/config`, `/etc/ssh/ssh_config`, files named `ssh.config`, and any file whose language you set
to "SSH Config". It works the same in local and remote windows and in Restricted Mode, and it complements
[remote-oss.remote-ssh](https://github.com/remote-oss/remote-ssh), which connects to the hosts these files describe.

This extension is part of the remote-oss family of remote extensions. It is not a Microsoft product and is not
affiliated with Microsoft.

## Questions, feedback and contributing

- Report a problem or ask a question: [remote-oss/remote-ssh-edit issues](https://github.com/remote-oss/remote-ssh-edit/issues)
- Source code: [remote-oss/remote](https://github.com/remote-oss/remote), folder `packages/remote-ssh-edit`

## Data collection

This extension collects no telemetry or usage data and sends nothing anywhere.

## License

MIT. The keyword documentation includes text from the OpenSSH manual page ssh_config(5), under the OpenSSH licence
in `ThirdPartyNotices.txt`.

## For maintainers

This package is built in the monorepo [remote-oss/remote](https://github.com/remote-oss/remote) (layout rule 6).

| | |
|---|---|
| Owner | area B (windows and explorer), from `docs/architecture/l3/windows-and-explorer/brief-remote-ssh-edit.md` |
| Features | F-4001, F-4002, F-4003, F-4101, F-4102, F-4201, F-4202, F-4203, F-4204, F-4901, F-4902 (remote-oss/remote-ssh-edit #6–#16) |
| Components | `sshedit.package` (manifest, string tables, README, licences), `sshedit.language` (`language-configuration.json`, `syntaxes/`), `sshedit.completion` (`src/`) |
| Allowed imports | `vscode` in `src/extension.ts` only (the adapter takes the API as a parameter); no extension, no library at run time |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host; the conformance cases cover it |
| Interim identity values | `description` (English in all 14 locales), `keywords`, no `icon`, `repository` and `bugs`: replaced in one commit when the family identity card is published (D-41) |

The keyword documentation in `src/keywords.ts` begins each text with the first sentence F-4201 section 3.4 quotes;
the rest is the KEYWORDS entry of OpenSSH 10.2p1 ssh_config(5). AskPassGUI, KeychainIntegration and the five GSSAPI
keywords have texts of our own (F-4902 §6).
