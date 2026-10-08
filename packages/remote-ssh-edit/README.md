# Remote - SSH: Editing Configuration Files

Highlighting and completion for SSH config files, with every keyword documented as you type.

## What you get

- Syntax highlighting for `ssh_config` files.
- Keyword completion, with the OpenSSH manual's wording for each keyword as you type.
- A snippet that sets up a port forward.

## Get started

1. Install the extension.
2. Open `~/.ssh/config`, or a file named `ssh.config`.
3. Start typing a keyword at the beginning of a line.

## Requirements

None beyond the editor.

## Settings and commands

This extension contributes no settings or commands.

## Part of remote-oss

Part of remote-oss, a collection of extensions that bring remote development to Code - OSS and the editors built on
it; install the Remote Development pack to get all of them.

## Support

Report a problem or ask a question in the issue tracker, https://github.com/remote-oss/remote/issues.

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
