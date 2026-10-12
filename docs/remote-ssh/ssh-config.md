# SSH configuration files

Remote - SSH takes its list of hosts, and the options each connection uses, from your SSH configuration. This page says
which files it reads and how to open one from the editor.

## Which files are read

Unless you say otherwise, the extension reads two files:

- **`~/.ssh/config`**, your own file. This is where you describe your hosts.
- **`/etc/ssh/ssh_config`**, the system-wide file. It applies to every user of the machine.

If you set `remote.SSH.configFile`, the extension reads that one file instead, and `ssh` is told to read it too. Only
its hosts are listed. A value that starts with `~/` means your home folder, and a relative value is looked for in your
home folder.

## Opening a configuration file

Run **Remote-SSH: Open SSH Configuration File...** from the Command Palette, or choose **Open SSH Configuration File**
under **More Actions...** when a connection fails. A list shows the files you can open:

- Without `remote.SSH.configFile`: your own file and the system file.
- With it: the file you named.
- Below the files, **Settings** opens the extension's settings, so you can point it at another file, and **Help** opens
  this page.

Choosing a file opens it in the editor. If the file does not exist yet, the extension makes it first, with its folders:
your own file and its `.ssh` folder are readable and writable by you alone, which is what `ssh` expects, and any other
file is created readable by everyone. A new file starts with a short example entry:

```
# Read more about SSH config files: https://linux.die.net/man/5/ssh_config
Host alias
    HostName hostname
    User user
```

The three words after `Host`, `HostName` and `User` are selected one after another, so you can type your own values
and press Tab to move on. The example follows your indentation settings. A file that already exists is opened as it is,
and nothing is added to it.

If the file cannot be made, for example because you may not write in its folder, the editor shows the reason.

## What goes in an entry

An entry begins with `Host` and a short name, and the options under it apply to that name:

- `Host` is the name you will pick in the editor, or type after `ssh`.
- `HostName` is the real address or DNS name of the machine.
- `User` is the account to log in as.

There are many more options; the OpenSSH manual lists them all in
[`ssh_config(5)`](https://linux.die.net/man/5/ssh_config).
