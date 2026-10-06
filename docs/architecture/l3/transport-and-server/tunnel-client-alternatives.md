# Remote - Tunnels client (A13): two alternatives for the user

- Status: facts for a decision by the user through the register; no recommendation is final until F-8902
  (srv#19) is accepted
- Date: 2026-10-06
- Author: `remote-architect-worker-1`; lead: `remote-architect`
- Requirements: F-8103 (srv#12), F-8102 (srv#11), F-8902 (srv#19, proposed), ADR-0004, ADR-0005, R-47, R-76

**The question.** A tunnel window needs a local endpoint that carries the editor's connection to the tunnel host
through the dev tunnels service. F-8103 BR-6 observed the reference doing this with a local helper process. Its
command name is `code`. It listens on `vscode-tunneling-<16 hex>.sock` in the user runtime folder. One helper is
shared by the windows of a profile, it is reused while it answers, and it ends 20 to 30 seconds after its last window.
Two ways exist to provide that endpoint.

| | A. The editor's own tunnel CLI as the relay | B. The MIT dev-tunnels client library |
|---|---|---|
| What runs | The running editor's tunnel executable, named by `product.json` `tunnelApplicationName` (`code-tunnel` for VS Code, `codium-tunnel` for VSCodium), started by the extension as a helper ([cli] `cli/src/commands/args.rs`) | The npm packages `@microsoft/dev-tunnels-connections`, `-management` and `-contracts` 1.3.60, bundled into the extension |
| Fetch and size | Usually none: the editor ships the executable in its own `bin` folder (F-8902). If it is missing, the CLI archive comes from the product's download location (R-47 extended). VSCodium 1.135.06055 archives are 8.6 to 11.8 MB | Bundled. About 0.75 MB unpacked for the three packages, plus about 1.2 MB for the required peer dependency `@microsoft/dev-tunnels-ssh` alone |
| Platforms | VSCodium publishes CLIs for darwin, linux and win32 on x64 and arm64, with no Alpine and no armhf. Those are client platforms here, so this is not a practical gap | Wherever the extension host runs |
| Licence | MIT, the `cli/` crate of VS Code OSS (R-76) | MIT |
| ADR fit | ADR-0005 decision 2 names the editor CLI for Tunnels. ADR-0004 is not touched | **Conflicts with ADR-0004 decision 1.** `@microsoft/dev-tunnels-connections` declares `@microsoft/dev-tunnels-ssh` and `@microsoft/dev-tunnels-ssh-tcp` as peer dependencies. Its relay session runs SSH over a web socket to the service, so the package is a JavaScript SSH implementation, which ADR-0004 rules out for every package. Option B needs a user exception to ADR-0004 that is limited to the dev tunnels relay |
| Sign-in | The CLI has its own device-code flow with built-in client ids and stores tokens in the OS keychain ([cli] `cli/src/auth.rs`). F-8902 allows sign-in only through `vscode.authentication`, so the extension must hand the CLI the token it got from the editor. The CLI accepts one through `--access-token` or `VSCODE_CLI_ACCESS_TOKEN`, but `tunnel user login` then writes it to the keychain. Whether the relay path can take a token without storing it must be read in [cli] before this option is chosen | The library takes the token from a callback, so `vscode.authentication` (F-8102 scopes) feeds it directly. Nothing is stored outside the editor |
| F-8103 BR-6, process and socket | Met as observed: a helper process and a socket in the runtime folder | Not met in the extension host: no process and no socket, and each window's extension host holds its own connection. It is met if the library runs inside our own detached helper, as A3 does for SSH. That helper runs on the editor's own runtime, whose executable is named after the product (`code`, `codium`) |
| F-8103 BR-6, sharing and lifetime | The CLI's own behaviour; sharing per profile depends on the arguments we pass | Our own code, in that helper. Same lease and grace design as A3 |
| Reload speed (F-8103 6.1: reuse, about 50 ms) | Met by reuse | Met only with the helper; in the extension host every reload reconnects to the service |
| CLI updates (F-8104) | Prompts concern the host CLI, which is core's, not this relay | Unaffected |
| Web (vscode.dev) | Not possible: a page starts no process | Possible in principle with `ManagedResolvedAuthority`. Moot today, because hosted vscode.dev offers no route to the `resolvers` proposal (F-8901) |
| Maintenance risk | Bound to the CLI's undocumented relay interface (hidden subcommands such as `command-shell`), which changes with editor releases | Bound to the library's API and to the service protocol. Microsoft publishes both, and they changed last on 2026-09-22 |

**What the user decides.**
1. **ADR-0004.** Either admit `@microsoft/dev-tunnels-ssh` as an exception that only the tunnel relay may use, or
   keep ADR-0004 whole and take option A.
2. **For option A.** Accept handing the editor's token to the CLI, and check that this stores nothing. Accept
   dependence on a hidden CLI interface.
3. **For option B.** Run it in an A3-style helper, so that F-8103 BR-6 and the reload timing hold. Otherwise those
   acceptance criteria become reference-only drift.

**Correction to the dossier.** Dossier question 4 recommended option B without knowing about its SSH dependency. I
withdraw that recommendation. Option A fits the accepted ADRs as they stand. Option B fits F-8902's sign-in rule
better but needs the ADR-0004 exception. Both need F-8902 accepted first.
