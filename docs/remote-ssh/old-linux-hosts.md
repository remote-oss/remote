# Hosts older than the server supports

When you connect to a Linux host whose C library is older than the server needs, the connection stops with the message
"The remote host does not meet the prerequisites for running VS Code Server." Nothing is installed to run, no setting
is changed, and the next attempt checks the host again. This page says what that means and what you can do about it.

## What is checked

The server needs glibc 2.28 or newer and libstdc++ 3.4.25 or newer (see
[What a Linux host needs for Remote - SSH](linux-prerequisites.md) for the whole list). Hosts below that, such as Ubuntu
18.04 (glibc 2.27) or RHEL and CentOS 7, are refused. The check runs after the first files are on the host, so the first
refusal can take a few seconds. The Remote - SSH log names the version it found and the one it expected.

Retry, and Reload Window, repeat the check. If you fixed the host in the meantime, the next attempt connects.

## Your options

1. **Use a host that meets the requirements.** Upgrade the distribution, or connect to a newer machine, or run a newer
   container on the old machine and connect to that.
2. **Use a custom sysroot.** This is a workaround for hosts below glibc 2.28, and it is yours to maintain:
   1. Build a sysroot that holds the library versions the server needs.
   2. Install `patchelf` on the host (version 0.18 or newer is recommended).
   3. Set three variables in the host's login environment, for example in `~/.profile`:

      | Variable | Value |
      | --- | --- |
      | `VSCODE_SERVER_CUSTOM_GLIBC_LINKER` | the sysroot's dynamic linker |
      | `VSCODE_SERVER_CUSTOM_GLIBC_PATH` | the sysroot's library folder |
      | `VSCODE_SERVER_PATCHELF_PATH` | the `patchelf` program |

   With the variables set, Remote - SSH does not refuse the host. The server patches its programs against the sysroot
   when it starts. The editor then shows a warning that you are connecting to an operating system it does not support;
   choosing **Allow** keeps the window connected, and **Cancel** closes the connection. That warning is the editor's, not
   the extension's, and it is not a promise that every extension works on that host.

Remote - SSH adds no setting of its own for any of this.
