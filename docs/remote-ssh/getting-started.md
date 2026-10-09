# Getting started with Remote - SSH

This page takes you from installing the extension to the first folder open on an SSH host. When something does not go
as described here, [the main guide](README.md#when-a-connection-fails) explains the messages you can meet.

## Before you start

You need three things:

- **An OpenSSH client on your machine.** Open a terminal and run `ssh -V`; if it prints a version that starts with
  `OpenSSH`, you are set. On Windows, install OpenSSH (Git for Windows ships one).
- **A host you can reach with `ssh`.** If `ssh <host>` works from your terminal, it works from the editor. Key-based
  login is the smoothest; passwords and one-time codes work too, and the editor asks for them when they are needed.
- **A supported host.** A Linux machine with a reasonably recent C library (glibc 2.28 or newer; Alpine on 64-bit Intel/AMD or ARM
  is supported too), on an Intel/AMD or ARM processor. The host needs `sh` and `tar`, and either `wget` or `curl` to fetch the
  server the first time. It needs no editor, no admin rights, and no software installed by hand.

## 1. Install the extension

Install **Remote - SSH** from the Extensions view. It comes with companion extensions: **Remote - SSH: Editing
Configuration Files**, which colours and completes your SSH config file, and **Remote Explorer**, which lists your
hosts in a side bar view. You do not need to configure anything to start.

If another extension that provides the same remote connection is installed, Remote - SSH steps aside and tells you
so, rather than running twice. Disable the other one and reload the window to use this one.

## 2. Describe your host (optional)

The editor reads your normal SSH configuration, `~/.ssh/config`, so every host you have named there is available by
its short name. A host entry looks like this:

```
Host buildbox
    HostName 192.0.2.10
    User alex
    IdentityFile ~/.ssh/id_ed25519
```

You can skip this step and type `alex@192.0.2.10` in the next one instead. To use a different configuration file, set
`remote.SSH.configFile` (see [Settings](README.md#settings)).

## 3. Connect

1. Open the Command Palette and run **Remote-SSH: Connect to Host...**, or click the remote indicator at the
   left of the status bar and choose it from the menu.
2. Choose a host from the list, or type `user@host` (add `:port` for a port other than 22) and press Enter.
3. A new window opens and a notification shows what the editor is doing: it connects, checks the host, downloads and
   installs the server if the host does not have it yet, and starts it. The first connection to a host takes the
   longest, because of the download; later ones take seconds.
4. When the status bar says `SSH: <host>` at its left end, you are connected. The window title carries the same
   name in square brackets.

**Remote-SSH: Connect Current Window to Host...** does the same in the window you are in, replacing what it showed.
**Remote-SSH: New Window on Active Host**, available in a connected window, opens one more window on the same host
without asking again for anything.

### Things you may be asked

- **Whether to trust the host.** The first time you connect to a host, you see a pick titled with the host name and the
  fingerprint of its key. Compare the fingerprint with the one your host administrator gave you (or with the output of
  `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the host). Choose **Continue** to trust the host and
  remember its key, or **Cancel** to stop.
- **A password, a passphrase or a one-time code.** A box appears at the top of the window with the question the host
  asked. Type the answer and press Enter. Press Escape to give up. Nothing you type is stored by the extension.
- **The server licence.** Some editors' servers carry a licence. When yours does, a dialog asks you to accept it before
  the server is installed; choosing Cancel ends the connection.

If you have several windows open on the same host, you answer these questions once: the other windows wait for the
first one and carry on when it is done.

## 4. Open a folder

In the connected window, use **File > Open Folder...** (or **Open Folder...** on the Welcome page). The file picker
that appears shows the host's files, starting in your home folder, which is written `~`. Choose a folder and confirm.
The window reloads on that folder; from then on, the Explorer, search, terminal, debugger and extensions all work on
the host.

To get back to your own machine, click the remote indicator and choose **Close Remote Connection**.

## 5. Work

- **Terminals** open on the host.
- **Extensions** that you install in this window install on the host when they need to run there; the ones that only
  change the interface stay on your machine.
- The next time you open the same folder, use **File > Open Recent**; entries on a host are marked
  `[SSH: <host>]`.

## If the connection does not work

A dialog tells you that the connection could not be established, usually with a short reason, and offers **Retry**,
**More Actions...** and **Close Remote**. Open **Remote-SSH: Show Log** for the full story of the attempt. The
[troubleshooting section](README.md#when-a-connection-fails) lists the common reasons and what to do about each.
