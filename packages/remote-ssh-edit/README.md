# Remote - SSH: Editing Configuration Files

Language support for OpenSSH configuration files in Code - OSS and the editors built on it:

- **Syntax highlighting** of keywords, values and comments.
- **Keyword completion**: at the start of a line, the list of `ssh_config` keywords, each with its documentation.
- **A tunnel template**: the "Configure tunnel" completion inserts a `Host` block with `HostName`, `LocalForward`
  and `User`, ready to fill in.
- **Editing aids**: line comments with `#`, bracket matching and auto-closing, indentation after a `Host` line.

It applies to `~/.ssh/config`, `/etc/ssh/ssh_config`, files named `ssh.config`, and any file whose language you set
to "SSH Config". It works the same in local and remote windows and in Restricted Mode, and it pairs with
[remote-oss.remote-ssh](https://github.com/remote-oss/remote-ssh), which connects to the hosts these files describe.

## Questions, feedback and contributing

- Report a problem or ask a question: [remote-oss/remote-ssh-edit issues](https://github.com/remote-oss/remote-ssh-edit/issues)
- Source code: [remote-oss/remote](https://github.com/remote-oss/remote), folder `packages/remote-ssh-edit`

## Data collection

This extension collects no telemetry or usage data and sends nothing anywhere.

## License

MIT. The keyword documentation includes text from the OpenSSH manual page ssh_config(5), under the OpenSSH licence
in `ThirdPartyNotices.txt`.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the `ssh_config` language and its file associations; activation and extension kind; package identity and localization; syntax highlighting; language configuration; keyword completion with documentation; the tunnel template; completion at other positions |
| Components | `sshedit.package` (manifest, string tables, README, licences), `sshedit.language` (`language-configuration.json`, `syntaxes/`), `sshedit.completion` (`src/`) |
| Allowed imports | `vscode` in `src/extension.ts` only (the adapter takes the API as a parameter); no extension, no library at run time |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host |
