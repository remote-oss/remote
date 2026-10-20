"""The window's own listeners (kit #289, K2): the listening addresses and ports held by the slot's editor and every
process below it, and by the ssh processes connected to the case's own SSH target wherever they run (after a reload a
helper that outlived the window holds them), each with its holder's name: `editor` for a process of the editor's own
executable (the extension host among them), `ssh` for an ssh client, else the process's name. Addresses, ports and
names only, sorted.

No command line is read: the editor is the process that holds its own IPC socket (`<profile>/<version>-main.sock`, or
`$XDG_RUNTIME_DIR/vscode-<sha256 of the profile path, 8 hex>-<version>-main.sock`), found in the unix socket table, and
the case's ssh is an `ssh` that holds an established TCP connection to the target's address. Of a process's open
files only its socket links (`socket:[inode]`) are read; nothing an extension wrote is read. The lab's own debugging
port on the editor (lab-code's 9222 + slot, which the driver reads the screen through) is not the window's.
"""
import hashlib
import os
import re
import socket

LISTEN, ESTABLISHED = "0A", "01"   # TCP states in /proc/net/tcp


def _address(hexaddr, v6):
    """An address of /proc/net/tcp(6): 32-bit words in the host's byte order."""
    raw = bytes.fromhex(hexaddr)
    words = b"".join(raw[i:i + 4][::-1] for i in range(0, len(raw), 4))
    return socket.inet_ntop(socket.AF_INET6 if v6 else socket.AF_INET, words)


def tcp_sockets(process, state):
    """{socket inode: (local address, local port, remote address)} of the TCP sockets in `state` in the network
    namespace of `process`, a /proc/<pid> folder: the holder's own, so a window in another namespace than the recorder's
    is still read right. A v4 peer of a v6 socket is given as v4."""
    out = {}
    for name, v6 in (("tcp", False), ("tcp6", True)):
        try:
            with open(f"{process}/net/{name}", encoding="ascii") as fh:
                lines = fh.read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if len(fields) < 10 or fields[3] != state:
                continue
            (local, port), (remote, _) = fields[1].split(":"), fields[2].split(":")
            peer = _address(remote, v6)
            out[int(fields[9])] = (_address(local, v6), int(port, 16), peer.removeprefix("::ffff:"))
    return out


def socket_inodes(pid, proc="/proc"):
    """The socket inodes among the open files of `pid`; any other open file is passed over and never kept."""
    try:
        fds = os.listdir(f"{proc}/{pid}/fd")
    except OSError:
        return set()
    out = set()
    for fd in fds:
        try:
            link = os.readlink(f"{proc}/{pid}/fd/{fd}")
        except OSError:
            continue
        if link.startswith("socket:[") and link.endswith("]"):
            out.add(int(link[8:-1]))
    return out


def processes(proc="/proc"):
    """{pid: (parent pid, executable name)} of the live processes."""
    out = {}
    for entry in os.listdir(proc):
        if not entry.isdigit():
            continue
        try:
            with open(f"{proc}/{entry}/stat", encoding="utf-8", errors="replace") as fh:
                stat = fh.read()
        except OSError:
            continue
        name = stat[stat.index("(") + 1:stat.rindex(")")]
        rest = stat[stat.rindex(")") + 2:].split()
        out[int(entry)] = (int(rest[1]), name)
    return out


def editor_sockets(user_data_dir, proc="/proc"):
    """The inodes of the editor's own IPC sockets for the profile `user_data_dir`, from the unix socket table: the main
    socket in the profile folder, or the one in $XDG_RUNTIME_DIR named by the profile path's digest."""
    scope = hashlib.sha256(user_data_dir.encode()).hexdigest()[:8]
    runtime = re.compile(r"[A-Za-z]+-" + scope + r"-[^/]+-main\.sock")
    out = set()
    try:
        with open(f"{proc}/net/unix", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()[1:]
    except OSError:
        return out
    for line in lines:
        fields = line.split(None, 7)
        if len(fields) < 8:
            continue
        folder, name = os.path.split(fields[7])
        if (folder == user_data_dir and name.endswith("-main.sock")) or runtime.fullmatch(name):
            out.add(int(fields[6]))
    return out


def editor_processes(user_data_dir, table, proc="/proc"):
    """The processes among `table` that hold the editor's own IPC socket for `user_data_dir`: the slot's editor."""
    held = editor_sockets(user_data_dir, proc)
    return {pid for pid in table if held and socket_inodes(pid, proc) & held}


def target_ssh_processes(target_address, table, proc="/proc"):
    """The ssh processes among `table` that hold an established TCP connection to `target_address`, the case's own SSH
    target, whose address is the run's own (its network is cut from the slot's block): another window's never is."""
    out = set()
    for pid, (_, name) in table.items():
        if name != "ssh":
            continue
        held = socket_inodes(pid, proc)
        connected = tcp_sockets(f"{proc}/{pid}", ESTABLISHED) if held else {}
        if any(connected[inode][2] == target_address for inode in held & set(connected)):
            out.add(pid)
    return out


def descendants(roots, table):
    """`roots` and every process below them, by parent pid."""
    children = {}
    for pid, (parent, _) in table.items():
        children.setdefault(parent, []).append(pid)
    found, todo = set(), list(roots)
    while todo:
        pid = todo.pop()
        if pid not in found:
            found.add(pid)
            todo.extend(children.get(pid, []))
    return found


def window_listeners(user_data_dir, proc="/proc", target_address=None, holder=None, lab_ports=()):
    """{listening: [{address: "<address>:<port>", holder}, ...]} of the editor on `user_data_dir` and every process
    below it, and with `target_address` of the ssh processes connected to it wherever they run; or an error when no
    editor holds that profile's IPC socket. Sorted by holder, then address, then port, so two holders' ports the kernel
    picked keep their order once normalization has replaced them; a case's client ports (the slot's range, below the
    kernel's ephemeral range) come before a port the kernel picked. The port is text, so ${PORT_<NAME>} and a bound
    value normalize in it. With `holder`, only that holder's listeners are kept; `lab_ports` are never listed."""
    table = processes(proc)
    roots = editor_processes(user_data_dir, table, proc)
    if not roots:
        return {"error": "client_listeners: no editor holds this slot's profile's IPC socket"}
    editor_names = {table[pid][1] for pid in roots}
    window = descendants(roots, table) | (target_ssh_processes(target_address, table, proc) if target_address else set())
    found = set()
    for pid in window:
        name = table.get(pid, (None, ""))[1]
        held_by = "editor" if name in editor_names else name
        held = socket_inodes(pid, proc)
        listening = tcp_sockets(f"{proc}/{pid}", LISTEN) if held else {}
        found |= {(held_by,) + listening[inode][:2] for inode in held & set(listening)
                  if listening[inode][1] not in lab_ports}
    return {"listening": [{"address": f"[{address}]:{port}" if ":" in address else f"{address}:{port}",
                           "holder": name} for name, address, port in sorted(found) if holder in (None, name)]}
