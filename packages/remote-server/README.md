# Remote - Tunnels

Reach your machines from anywhere through a secure tunnel, with nothing to expose and no ports to forward.

Run the project's host agent on the machine you want to reach, sign in with your GitHub account in the editor, and open
that machine from the Remote Indicator: "Connect to Tunnel...".

## Hosting a tunnel

The project's host agent, `tunnel-agent`, is the way to host a tunnel: it is a separate program, not part of this
extension, and the extension contributes no command that makes your machine a tunnel host. The editor's own tunnel
host feature, where a build has one, serves a service other than the project's relay; this client is built against the
project's host agent.

## Privacy

This extension collects no telemetry and sends nothing about your use of it anywhere. Its requests go to the project's
relay and to GitHub's sign-in, through the editor, and to nothing else.

## Using it beside another Remote - Tunnels extension

Two Remote - Tunnels extensions together are unsupported. When an extension with the same identifiers is enabled in
the window, this one stays inactive and shows one warning, with a button that opens the other in the Extensions view.
A pack or an extension that lists another publisher's Remote - Tunnels extension installs that one, so install this
one directly. Disable one of the two and reload the window.

## For administrators

This extension is outside the Windows dev tunnels group policy set. It reads no such policy: administrators control it
by the relay's domain it is built with and by the editor's own extension policies.

## Help and licence

Issues and questions go to the project's issues page, <https://github.com/remote-oss/remote/issues>. The licence is MIT.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest: identity, activation events, the six desktop commands, their menus; the activation with the stand-down, the commands' registration and the lazy Output channel |
| Components | `tunnels.package` (manifest, string tables, identifiers) and activation (`src/activation.ts`, `src/commands.ts`, `src/output-channel.ts`, `src/strings.ts`, `src/extension.ts`) |
| Allowed imports | `lib-identifiers`, `lib-standdown`; `vscode` in `src/extension.ts` only |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host |
