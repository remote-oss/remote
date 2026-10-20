#!/usr/bin/env python3
"""Client port fixtures (kit #289, K1, 2026-10-20): ports on the recording machine, made before the
window connects and removed at teardown, for the criteria about local port ranges, busy and unbindable ports.

A case names them in `fixture.client_ports: [{name, kind}]`; each is bound as ${PORT_<NAME>} (upper case, '-' as '_').
  free        a port of the slot's range, checked unbound, not listened on (a forward that must succeed names it)
  v4 | v6     an accepting listener on 127.0.0.1 | ::1
  both        one port held on 127.0.0.1 and ::1
  any         an accepting listener on 0.0.0.0
  stalled     a listener on 127.0.0.1 that neither accepts nor refuses: its accept queue is full, so a connect hangs
  unbindable  a privileged port the recording user can't bind (proven at up, refused where it binds)

The step `client_ports: free` ends the holder mid-case: every port it held is unbound from then to the case's end.

The slot's ports are PORT_BASE + 16 * slot + i (i < 16), refused when they overlap the kernel's ephemeral range. A
detached holder process keeps the listeners; its pid sits beside the slot (the slot's folder is made again each case),
and the slot's next case removes a holder its last case left behind.
    clientports.py hold <plan.json>      the holder (provision starts it)
"""
import errno
import json
import os
import re
import select
import signal
import socket
import subprocess
import sys
import threading
import time

PORT_BASE = 30000
PER_SLOT = 16
KINDS = ("free", "v4", "v6", "both", "any", "stalled", "unbindable")
NAME = re.compile(r"^[a-z][a-z0-9-]*$")
EPHEMERAL = "/proc/sys/net/ipv4/ip_local_port_range"
READY = "clientports: ready"


class PortError(Exception):
    """A client port fixture that can't be made here, with the reason."""


def placeholder(name):
    return "PORT_" + name.upper().replace("-", "_")


def slot_ports(slot):
    return range(PORT_BASE + PER_SLOT * slot, PORT_BASE + PER_SLOT * (slot + 1))


def ephemeral_range(path=EPHEMERAL):
    with open(path, encoding="utf-8") as f:
        low, high = f.read().split()[:2]
    return int(low), int(high)


def fixture_errors(ports):
    """What is wrong with a case's `fixture.client_ports` (the schema's check; no socket is touched)."""
    if not isinstance(ports, list) or not ports:
        return ["client_ports must be a non-empty list of {name, kind}"]
    errs, names = [], set()
    for p in ports:
        if not isinstance(p, dict) or set(p) != {"name", "kind"}:
            errs.append(f"client_ports entry {p!r} must be exactly {{name, kind}}")
            continue
        if not isinstance(p["name"], str) or not NAME.match(p["name"]):
            errs.append(f"client_ports name {p['name']!r} must be lower-case words joined by '-'")
        elif p["name"] in names:
            errs.append(f"client_ports name {p['name']!r} used twice")
        names.add(p["name"])
        if p["kind"] not in KINDS:
            errs.append(f"client_ports {p['name']!r}: kind {p['kind']!r} is not one of {', '.join(KINDS)}")
    if sum(1 for p in ports if isinstance(p, dict) and p.get("kind") != "unbindable") > PER_SLOT:
        errs.append(f"client_ports: at most {PER_SLOT} ports of the slot's range")
    return errs


def _bindable(family, address, port):
    s = socket.socket(family, socket.SOCK_STREAM)
    try:
        if family == socket.AF_INET6:
            s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        s.bind((address, port))
        return True, None
    except OSError as e:
        return False, e
    finally:
        s.close()


def plan(ports, slot, ephemeral=None):
    """The case's ports, each with its number: checked here, before anything listens (PortError with the reason)."""
    errs = fixture_errors(ports)
    if errs:
        raise PortError("; ".join(errs))
    rng = slot_ports(slot)
    low, high = ephemeral or ephemeral_range()
    if rng.start <= high and low <= rng.stop - 1:
        raise PortError(f"slot {slot}'s client ports {rng.start}-{rng.stop - 1} overlap the kernel's ephemeral range "
                        f"{low}-{high} ({EPHEMERAL}): ssh's own ports could take them")
    if any(p["kind"] in ("v6", "both") for p in ports) and not _bindable(socket.AF_INET6, "::1", 0)[0]:
        raise PortError("::1 can't be bound here, so a v6 or both port can't be made")
    out, free = [], iter(rng)
    for p in ports:
        if p["kind"] == "unbindable":
            out.append(dict(p, port=_unbindable(slot)))
            continue
        for port in free:
            families = [(socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")] if p["kind"] in ("v6", "both") \
                else [(socket.AF_INET, "0.0.0.0" if p["kind"] == "any" else "127.0.0.1")]
            if all(_bindable(f, a, port)[0] for f, a in families):
                out.append(dict(p, port=port))
                break
        else:
            raise PortError(f"no unbound port left in slot {slot}'s range {rng.start}-{rng.stop - 1}")
    return out


def _unbindable(slot):
    """A privileged port this user can't bind, proven by trying: refused where privileged ports bind (a container with
    ip_unprivileged_port_start=0)."""
    for port in range(1023 - slot % 500, 524, -1):
        ok, err = _bindable(socket.AF_INET, "127.0.0.1", port)
        if ok:
            raise PortError(f"port {port} binds here (privileged ports aren't protected on this host), so an "
                            "unbindable port can't be made")
        if err.errno == errno.EACCES:
            return port
    raise PortError("no privileged port refused binding with EACCES")


def placeholders(planned):
    return {placeholder(p["name"]): str(p["port"]) for p in planned}


# ---- the holder
def _serve(sock):
    """Accept and keep each connection until the holder ends: an ordinary listener's behaviour."""
    held = []
    while True:
        try:
            conn, _ = sock.accept()
            held.append(conn)
        except OSError:
            return


def _listener(family, address, port, backlog=16):
    s = socket.socket(family, socket.SOCK_STREAM)
    if family == socket.AF_INET6:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    s.bind((address, port))
    s.listen(backlog)
    return s


def _stall(port):
    """A listener that never accepts, with its queue filled by connections the holder makes and keeps: one more
    connect neither completes nor is refused."""
    s = _listener(socket.AF_INET, "127.0.0.1", port, backlog=0)
    fillers = []
    for _ in range(8):
        c = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        c.setblocking(False)
        try:
            c.connect(("127.0.0.1", port))
        except BlockingIOError:
            pass
        fillers.append(c)
        if not hangs(port, 0.2):
            continue
        return s, fillers
    raise PortError(f"port {port}: the accept queue didn't fill")


def hangs(port, seconds):
    """Whether a connect to 127.0.0.1:port neither completes nor is refused within `seconds`."""
    c = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    c.setblocking(False)
    try:
        c.connect(("127.0.0.1", port))
        return False
    except BlockingIOError:
        _, writable, _ = select.select([], [c], [], seconds)
        return not writable
    except OSError:
        return False
    finally:
        c.close()


PLACES = {"v4": [(socket.AF_INET, "127.0.0.1")], "v6": [(socket.AF_INET6, "::1")],
          "both": [(socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")], "any": [(socket.AF_INET, "0.0.0.0")],
          "stalled": [(socket.AF_INET, "127.0.0.1")]}   # where the holder listens, by kind


def hold(planned):
    """Open every port of the plan, say ready, and keep them until TERM."""
    keep = []
    for p in planned:
        kind, port = p["kind"], p["port"]
        if kind in ("free", "unbindable"):
            continue
        if kind == "stalled":
            keep.append(_stall(port))
            continue
        for family, address in PLACES[kind]:
            s = _listener(family, address, port)
            keep.append(s)
            threading.Thread(target=_serve, args=(s,), daemon=True).start()
    print(READY, flush=True)
    signal.sigwait({signal.SIGTERM, signal.SIGINT})


def still_held(planned, seconds=5):
    """The names of the plan's held ports that a listener still can't bind after up to `seconds`, as a listener binds
    (SO_REUSEADDR: the holder's closed connections linger in TIME_WAIT, which no listener waits for)."""
    def bound(family, address, port):
        s = socket.socket(family, socket.SOCK_STREAM)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if family == socket.AF_INET6:
                s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            s.bind((address, port))
            return False
        except OSError:
            return True
        finally:
            s.close()
    held = [p for p in planned if p["kind"] in PLACES]
    deadline = time.monotonic() + seconds
    while True:
        left = [p["name"] for p in held if any(bound(f, a, p["port"]) for f, a in PLACES[p["kind"]])]
        if not left or time.monotonic() > deadline:
            return left
        time.sleep(0.1)


# ---- start, stop, and the slot's leftovers
def pid_file(slots_dir, slot):
    return os.path.join(slots_dir, f"client-ports-{slot}.json")


def stop(slots_dir, slot):
    """End the slot's holder, if any (this case's, or one an earlier case left); True when none is left."""
    path = pid_file(slots_dir, slot)
    try:
        with open(path, encoding="utf-8") as f:
            pid = json.load(f)["pid"]
    except (OSError, ValueError, KeyError):
        return True
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            os.kill(pid, 0)
            time.sleep(0.1)
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.remove(path)
    return True


def start(planned, slots_dir, slot, run_id):
    """Start the holder for the plan (after removing any the slot's last case left); returns its pid."""
    stop(slots_dir, slot)
    p = subprocess.Popen([sys.executable, os.path.abspath(__file__), "hold", json.dumps(planned)],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    ready, _, _ = select.select([p.stdout], [], [], 10)
    line = p.stdout.readline().strip() if ready else ""
    if line != READY:
        p.kill()
        why = line or p.stderr.read()[-300:] or "no answer in 10 s"
        p.stdout.close()
        p.stderr.close()
        raise PortError("the client port holder didn't start: " + why)
    p.stdout.close()   # the holder writes nothing after its ready line
    p.stderr.close()
    os.makedirs(slots_dir, exist_ok=True)
    with open(pid_file(slots_dir, slot), "w", encoding="utf-8") as f:
        json.dump({"pid": p.pid, "run": run_id, "ports": planned}, f)
    return p.pid


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "hold":
        try:
            hold(json.loads(sys.argv[2]))
        except (PortError, OSError) as e:
            print(f"clientports: {e}", flush=True)
            sys.exit(1)
    else:
        sys.exit(__doc__)
