# Epic map of the remote-oss family

Source: GitHub issues labelled type:epic and type:tracking in the seven remote-oss repos, read 2026-10-06. Own phrases only. Counts: published = feature issue exists without spec:pending; pending = label spec:pending; reviewed = label spec:reviewed (extra column).


## remote-containers

Tracking issue #15 (feature inventory and coverage); 100 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E01 | #1 | Foundation and cross-cutting behavior | F-0101, F-0102, F-0103, F-0104, F-0105, F-0106, F-0107, F-0108, F-0109 | 9 | 0 | 8 | none |
| E02 | #2 | Container engine and host environment | F-0201, F-0202, F-0203, F-0204, F-0205, F-0206, F-0207 | 7 | 0 | 6 | remote-wsl (F-0204, F-0207) |
| E03 | #3 | Configuration discovery and model | F-0301, F-0302, F-0303, F-0304, F-0305, F-0306 | 6 | 0 | 5 | none |
| E04 | #4 | Dev container lifecycle | F-0401, F-0402, F-0403, F-0404, F-0405, F-0406, F-0407, F-0408, F-0409, F-0410, F-0411, F-0412, F-0413, F-0414, F-0415, F-0416, F-0417, F-0418, F-0419 | 19 | 0 | 17 | remote-wsl (F-0406); remote-ssh (F-0406); remote-server (F-0406) |
| E05 | #5 | Remote connection and window integration | F-0501, F-0502, F-0503, F-0504, F-0505, F-0506, F-0507 | 7 | 0 | 7 | none |
| E06 | #6 | Attach to running containers | F-0601, F-0602, F-0603, F-0604, F-0605 | 5 | 0 | 3 | none |
| E07 | #7 | Repositories in container volumes | F-0701, F-0702, F-0703, F-0704, F-0705, F-0706, F-0707, F-0708 | 8 | 0 | 8 | none |
| E08 | #8 | Creating and editing configurations | F-0801, F-0802, F-0803, F-0804, F-0805, F-0806, F-0807, F-0808, F-0809, F-0810, F-0811, F-0812 | 12 | 0 | 12 | none |
| E09 | #9 | Remote Explorer views | F-0901, F-0902, F-0903, F-0904, F-0905, F-0906 | 6 | 0 | 5 | remote-explorer (F-0906) |
| E10 | #10 | Credentials and host services in the container | F-1001, F-1002, F-1003, F-1004, F-1005, F-1006, F-1007, F-1008 | 8 | 0 | 7 | remote-ssh (agent forwarding, F-1003) |
| E11 | #11 | Ports and networking | F-1101, F-1102, F-1103 | 3 | 0 | 2 | none |
| E12 | #12 | Developer tooling | F-1201, F-1202 | 2 | 0 | 1 | none |
| E13 | #13 | Interop with other remotes | F-1301, F-1302 | 2 | 0 | 2 | remote-wsl (F-1301); remote-ssh (F-1302); remote-server (F-1302) |
| E14 | #14 | OSS adaptation decisions | F-1401, F-1402, F-1403, F-1404, F-1405 | 5 | 0 | 5 | none |

Totals: published 99, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-ssh

Tracking issue #10 (feature inventory and coverage); 75 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E20 | #1 | Foundation, help and command surface | F-2001, F-2002, F-2003, F-2004, F-2005, F-2006, F-2007, F-2008 | 8 | 0 | 0 | none |
| E21 | #2 | SSH client and connection mechanics | F-2101, F-2102, F-2103, F-2104, F-2105, F-2106, F-2107, F-2108, F-2109 | 9 | 0 | 0 | none |
| E22 | #3 | SSH configuration and hosts | F-2201, F-2202, F-2203, F-2204, F-2205, F-2206 | 6 | 0 | 0 | none |
| E23 | #4 | Connecting and authenticating | F-2301, F-2302, F-2303, F-2304, F-2305, F-2306, F-2307, F-2308, F-2309, F-2310, F-2311, F-2312 | 12 | 0 | 0 | none |
| E24 | #5 | VS Code Server on the host | F-2401, F-2402, F-2403, F-2404, F-2405, F-2406, F-2407, F-2408, F-2409, F-2410, F-2411, F-2412, F-2413 | 13 | 0 | 0 | none |
| E25 | #6 | The remote window | F-2501, F-2502, F-2503, F-2504, F-2505, F-2506, F-2507, F-2508, F-2509 | 9 | 0 | 0 | remote-explorer (internal commands the Remotes view calls) |
| E26 | #7 | Errors and diagnostics | F-2601, F-2602, F-2603, F-2604, F-2605, F-2606 | 6 | 0 | 0 | chat participant text only, no other repo |
| E27 | #8 | Remote platforms and shells | F-2701, F-2702, F-2703, F-2704 | 4 | 0 | 1 | none |
| E39 | #9 | Decisions | F-3901, F-3902, F-3903, F-3904, F-3905, F-3906, F-3907 | 7 | 0 | 0 | none |

Totals: published 74, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-ssh-edit

Tracking issue #5 (feature inventory and coverage); 11 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E40 | #1 | Language registration and runtime | F-4001, F-4002, F-4003 | 3 | 0 | 3 | none |
| E41 | #2 | Syntax and language configuration | F-4101, F-4102 | 2 | 0 | 2 | none |
| E42 | #3 | Authoring aids | F-4201, F-4202, F-4203, F-4204 | 4 | 0 | 4 | remote-server (tunnel snippet, F-4202) |
| E49 | #4 | Decisions | F-4901, F-4902 | 2 | 0 | 2 | none |

Totals: published 11, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-explorer

Tracking issue #6 (feature inventory and coverage); 11 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E50 | #1 | Extension and command surface | F-5001, F-5002 | 2 | 0 | 2 | none |
| E51 | #2 | The Remotes view and its SSH targets | F-5101, F-5102, F-5103, F-5104 | 4 | 0 | 4 | remote-ssh (SSH group, F-5102) |
| E52 | #3 | Tunnels in the Remotes view | F-5201, F-5202 | 2 | 0 | 2 | remote-server (tunnel machines, family Remote Tunnels policy); remote-wsl (F-5202 distros on tunnel machine) |
| E53 | #4 | Family combination | F-5301 | 1 | 0 | 1 | remote-ssh; remote-containers; remote-server; remote-wsl (each owner's view feature) |
| E59 | #5 | Decisions | F-5901, F-5902 | 2 | 0 | 2 | all family companions (F-5902) |

Totals: published 11, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-wsl

Tracking issue #10 (feature inventory and coverage); 29 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E60 | #1 | Foundation and cross-cutting behaviour | F-6001, F-6002, F-6003, F-6004, F-6005 | 3 | 2 | 0 | none |
| E61 | #2 | WSL presence and distros | F-6101, F-6102, F-6103 | 0 | 3 | 0 | none |
| E62 | #3 | Connecting to a distro | F-6201, F-6202, F-6203, F-6204, F-6205, F-6206, F-6207, F-6208 | 5 | 3 | 0 | none |
| E63 | #4 | VS Code Server in the distro | F-6301, F-6302, F-6303, F-6304 | 2 | 2 | 0 | none |
| E64 | #5 | The code command | F-6401, F-6402 | 1 | 1 | 0 | none |
| E65 | #6 | Remote Explorer: WSL Targets | F-6501, F-6502, F-6503 | 1 | 2 | 0 | remote-explorer (WSL Targets rows) |
| E66 | #7 | Working in a WSL window | F-6601, F-6602 | 0 | 2 | 0 | none |
| E67 | #8 | Interop with other remotes | F-6701 | 0 | 1 | 0 | remote-ssh (F-6701); remote-containers (cited, not specified) |
| E79 | #9 | OSS adaptation decisions | F-7901 | 1 | 0 | 0 | none |

Totals: published 13, pending 16. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-server

Tracking issue #6 (feature inventory and coverage); 13 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E80 | #1 | Extension shell and command surface | F-8001, F-8002 | 2 | 0 | 0 | remote-extensionpack (pack brings Remote Explorer); remote-explorer |
| E81 | #2 | Connecting to a tunnel | F-8101, F-8102, F-8103, F-8104 | 4 | 0 | 0 | none |
| E82 | #3 | Tunnels in the Remotes view and the tunnel window | F-8201, F-8202, F-8203 | 3 | 0 | 0 | remote-explorer (Tunnels group, look owned there) |
| E83 | #4 | VS Code for the Web | F-8301, F-8302 | 2 | 0 | 0 | none |
| E89 | #5 | Decisions | F-8901, F-8902 | 2 | 0 | 1 | none |

Totals: published 13, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## remote-extensionpack

Tracking issue #4 (feature inventory and coverage); 6 feature issues.

| Epic | Issue | Title | Feature ids | Published | Pending | Reviewed | Cross-repo citations |
|---|---|---|---|---|---|---|---|
| E90 | #1 | Package identity and listing | F-9001, F-9002 | 2 | 0 | 0 | none |
| E91 | #2 | Membership and pack behaviour in the editor | F-9101, F-9102, F-9103 | 3 | 0 | 0 | none |
| E99 | #3 | Decisions | F-9901 | 1 | 0 | 1 | none |

Totals: published 6, pending 0. Tracking issue cross-repo mentions: see epic rows (tracking text mentions family members only in its coverage prose).


## Cross-repo dependency sketch

Edges read as: epics of A cite or rely on B.

- remote-containers -> remote-explorer
- remote-containers -> remote-server
- remote-containers -> remote-ssh
- remote-containers -> remote-wsl
- remote-explorer -> remote-containers
- remote-explorer -> remote-server
- remote-explorer -> remote-ssh
- remote-explorer -> remote-wsl
- remote-server -> remote-explorer
- remote-server -> remote-extensionpack
- remote-ssh -> remote-explorer
- remote-ssh-edit -> remote-server
- remote-wsl -> remote-containers
- remote-wsl -> remote-explorer
- remote-wsl -> remote-ssh

## Questions

- Epic and tracking issues carry no pending label; pending counts come from feature issues, and only remote-wsl uses spec:pending.
- Edges come from epic feature titles and short epic text; feature bodies were not read for citations.
- No spec cites reference script text or lab transcripts in the epic or tracking issues read.
