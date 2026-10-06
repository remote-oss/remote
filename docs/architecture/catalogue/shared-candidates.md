# Shared-behaviour candidates

Merged and deduplicated from section 5 of the seven adversary files, 2026-10-06. Each line: behaviour (own phrase, with the proposed single home), then the ids involved.

- Proposed-API enablement route and setup notification (one lib-product gate): F-3903, F-2001, F-1403, F-0101, F-1102, F-6001, F-8001, F-8103, F-5101, F-9901, F-4101
- Stand-down when the reference extension is present, with identity tables (one lib-standdown plus lib-identifiers; pick one library per row): F-3901, F-2001, F-2006, F-1401, F-1406, F-5901, F-5001, F-8901, F-8001, F-8101, F-7901, F-4901, F-9002, F-9901, F-6001
- Authority resolver skeleton, resource label formatter and reconnect (lib-authority): F-2501, F-2502, F-6201, F-6205, F-6402, F-6701, F-8103, F-8001, F-0501, F-0502, F-0504, F-0601, F-0701
- Out-of-context command guard (R-46): one helper: F-0109, F-5002, F-5101, F-5102, F-5103, F-5104, F-5201, F-5202, F-5001, F-8001, F-8101, F-8201, F-8301, F-2006
- Companion command contract and typed client (lib-companion): F-5902, F-3906, F-2503, F-2202, F-8201, F-5901, F-5104, F-6503
- SSH config file discovery and parsing, remote.SSH.configFile (one lib-ssh-config; explorer consumes via companion): F-2201, F-2202, F-2203, F-2204, F-2008, F-2106, F-3906, F-4001, F-4002, F-4201, F-4204, F-5001, F-5002, F-5101, F-5102, F-5103, F-5104, F-5301, F-0417, F-0708, F-1002
- ssh_config language and keyword knowledge (one identifiers/keywords library: language id, scope root, keyword table): F-4902, F-4001, F-4201, F-2007, F-2201, F-2203, F-2204, F-5001, F-5101, F-5102, F-9901
- Server download source and templates (lib-server-source): F-3902, F-2403, F-8902, F-8104, F-6301, F-6302, F-6303, F-1402, F-0503, F-0102
- Server install cache, layout and shared installer (lib-server): F-0419, F-2409, F-2413, F-6201, F-6301, F-6401, F-2403
- HTTP(S) proxy environment for server install (one proxy-config helper): F-2404, F-2405, F-0803, F-0801, F-0804, F-0806, F-6301
- Server launch handshake and connection token: F-2409, F-2410, F-6002, F-6201, F-6304, F-0502, F-0503
- Default extensions installed on the remote (one installer): F-2506, F-8001, F-8104, F-0505, F-0102, F-9103
- l10n bundles and package.nls build step (one shared step and parity check): F-2002, F-0103, F-6005, F-5001, F-8001, F-4003, F-4202, F-9001, F-5901
- Help, Get Started, Settings and Report Issue commands (one help library): F-2004, F-2005, F-3901, F-0105, F-6003, F-8002
- Package, activation, trust, virtual workspace and extensionKind gates (one lib-product or manifest checklist): F-2001, F-2007, F-4002, F-0101, F-0106, F-0505, F-0603, F-1202, F-5001, F-5101, F-5201, F-5902, F-6001, F-8001, F-9103
- Agent forwarding into the remote (shared agent-socket forwarder): F-2311, F-1003, F-1001, F-1004, F-1006, F-1007, F-2312, F-1008
- Port forwarding provider and tunnel factory: F-2104, F-2507, F-1101, F-1102, F-1103, F-8202
- Failure dialog with Retry/Close and silence watchdog (shared lib-failure): F-2601, F-0410, F-6208
- Log channel and log terminal, token masking as one family rule: F-2003, F-0104, F-0408, F-6002
- No-telemetry ruling (family rule): F-1405, F-3905, F-8901, F-6005, F-9901, F-4003
- Remote Explorer view registration, contribViewsRemote (one views.remote helper): F-5101, F-0906, F-5902, F-3906, F-6501
- Recent folders under a target and folder history store: F-5104, F-6503, F-8201, F-5902
- Reopen origin and reopen-in-X with path translation (shared helper): F-0406, F-1301, F-1302, F-6204, F-6701
- wsl.exe client: distro listing, command runner, wsl.conf reading: F-0207, F-0204, F-1301, F-6201, F-6203, F-6204, F-6205, F-6401
- UNC to wsl+ path mapping: F-6203, F-6204, F-6503
- Per-host platform store, remote.SSH.remotePlatform: F-2206, F-6701
- Companion and marketplace policy: F-1404, F-0603, F-3904, F-5902
- Placement by extension kind and Install Locally conformance fixtures: F-9103, F-0505, F-6001, F-8104
- Publishing and release gate on Open VSX plus gallery dependency: F-9901, F-9002, F-1404
- Continue working / edit sessions: F-0707, F-8301
- ssh-remote authority and vscode-remote folder URI (lib-authority): F-5103, F-5104, F-2501, F-2502
- SSH agent and X11 forwarding: F-1003, F-1008, F-2311, F-2312
