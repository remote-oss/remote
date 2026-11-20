# What a Linux host needs for Remote - SSH

The server that Remote - SSH installs on a host runs on the host's own C library. This page lists what the host needs
for it, how to see what it has, and the packages that provide it. If a connection was refused because the host does not
meet these, [Hosts older than the server supports](old-linux-hosts.md) explains what you can do.

## The requirements

| What | Minimum |
| --- | --- |
| Linux kernel | 4.18 or newer |
| glibc | 2.28 or newer |
| libstdc++ | 3.4.25 or newer |
| `tar` and `gzip` | any version; `gzip` is needed to unpack the server archive |
| `curl` or `wget` | either one, to download the server (or let your machine download it: `remote.SSH.localServerDownload`) |
| An SSH server and `sh` | the SSH server you connect to, and a POSIX shell for your login |

On 32-bit ARM hosts `libatomic` is needed too. The host needs no editor, no administrator rights and no software
installed by hand; the server lives in your home folder.

## Checking a host

On the host, run these and compare with the table:

```sh
uname -r                 # the kernel
ldd --version | head -1  # glibc
```

For libstdc++, look at the newest `GLIBCXX` version your system library offers, for example with
`strings /usr/lib/x86_64-linux-gnu/libstdc++.so.6 | grep GLIBCXX | tail -1`. Version 3.4.25 corresponds to `GLIBCXX_3.4.25`.

## Packages by distribution

| Distribution family | Packages |
| --- | --- |
| Debian, Ubuntu | `libc6`, `libstdc++6`, `ca-certificates`, `tar` |
| RHEL, CentOS, Oracle Linux 8 and later | `glibc`, `libgcc`, `libstdc++`, `ca-certificates`, `tar` |
| openSUSE, SLE 15 and later | `glibc`, `libgcc_s1`, `libstdc++6`, `ca-certificates`, `gzip`, `tar` |

## Distributions

These meet the minimums: Debian 10 and newer, Ubuntu 20.04 and newer, RHEL, CentOS and Oracle Linux 8 and newer,
openSUSE and SLES 15 and newer. Their predecessors (Debian 9, Ubuntu 18.04, RHEL, CentOS and Oracle Linux 7) have an
older glibc or libstdc++ and are refused. Alpine Linux works when `libstdc++` and `libgcc` are installed. ARM hosts and
Alpine are previews: extensions that bring native code may not work there.

If your host is refused, read [Hosts older than the server supports](old-linux-hosts.md).
