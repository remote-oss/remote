"""The window's own listeners (kit #289, K2): the listening addresses and ports held by the slot's editor and every
process below it, read from the socket table, each with its holder's name: `editor` for a process of the editor's own
executable (the extension host among them), `ssh` for an ssh client, else the process's name. Addresses, ports and
names only, sorted. A command line is read only to find the editor by its profile folder and never kept; nothing an
extension wrote is read.
"""
import os
import socket

LISTEN = "0A"   # the TCP state LISTEN in /proc/net/tcp


def _address(hexaddr, v6):
    """An address of /proc/net/tcp(6): 32-bit words in the host's byte order."""
    raw = bytes.fromhex(hexaddr)
    words = b"".join(raw[i:i + 4][::-1] for i in range(0, len(raw), 4))
    return socket.inet_ntop(socket.AF_INET6 if v6 else socket.AF_INET, words)


def listening_sockets(process):
    """{socket inode: (address, port)} of every listening TCP socket in the network namespace of `process`, a
    /proc/<pid> folder: the holder's own, so a window in another namespace than the recorder's is still read right."""
    out = {}
    for name, v6 in (("tcp", False), ("tcp6", True)):
        try:
            with open(f"{process}/net/{name}", encoding="ascii") as fh:
                lines = fh.read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if len(fields) < 10 or fields[3] != LISTEN:
                continue
            address, port = fields[1].split(":")
            out[int(fields[9])] = (_address(address, v6), int(port, 16))
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


def editor_processes(user_data_dir, pids, proc="/proc"):
    """The processes among `pids` started with `--user-data-dir <user_data_dir>`: the slot's editor."""
    out = set()
    for pid in pids:
        try:
            with open(f"{proc}/{pid}/cmdline", "rb") as fh:
                argv = fh.read().decode(errors="replace").split("\0")
        except OSError:
            continue
        if f"--user-data-dir={user_data_dir}" in argv or any(
                a == "--user-data-dir" and b == user_data_dir for a, b in zip(argv, argv[1:])):
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


def window_listeners(user_data_dir, proc="/proc"):
    """{listening: [{address: "<address>:<port>", holder}, ...]} of the editor on `user_data_dir` and every process
    below it, or an error when no editor runs on it. Sorted by holder, then address, then port, so two holders' ports
    the kernel picked keep their order once normalization has replaced them; a case's client ports (the slot's range,
    below the kernel's ephemeral range) come before a port the kernel picked. The port is text, so ${PORT_<NAME>} and a
    bound value normalize in it."""
    table = processes(proc)
    roots = editor_processes(user_data_dir, table, proc)
    if not roots:
        return {"error": "client_listeners: no editor runs on this slot's profile"}
    editor_names = {table[pid][1] for pid in roots}
    found = set()
    for pid in descendants(roots, table):
        name = table.get(pid, (None, ""))[1]
        holder = "editor" if name in editor_names else name
        try:
            links = [os.readlink(f"{proc}/{pid}/fd/{fd}") for fd in os.listdir(f"{proc}/{pid}/fd")]
        except OSError:
            continue
        sockets = listening_sockets(f"{proc}/{pid}")
        for link in links:
            if link.startswith("socket:[") and int(link[8:-1]) in sockets:
                found.add((holder,) + sockets[int(link[8:-1])])
    return {"listening": [{"address": f"[{address}]:{port}" if ":" in address else f"{address}:{port}",
                           "holder": holder} for holder, address, port in sorted(found)]}
