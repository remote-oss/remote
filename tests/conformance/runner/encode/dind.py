"""Private Docker daemons, one per run and slot (docker:dind), each in its own address pool."""
import os, shutil, subprocess, sys, time

# >>> docker mode (the conformance runner gets a copy of this region as dind.py)
LABEL = ""
ROOT = os.environ.get("ENCODE_ROOT") or os.environ.get("CONFORMANCE_WORK") or os.path.expanduser("~/conformance-work")
WS = os.environ.get("ENCODE_DIND_MOUNT") or f"{ROOT}/workspaces"   # mounted into the daemon at the same path
ISO = os.environ.get("ENCODE_ISO") or f"{ROOT}/iso"
# A private daemon's address space, one /16 per slot: slot 1 -> 10.201.0.0/16 ... slot 55 -> 10.255, slot 56 ->
# 10.128 ... slot 127 -> 10.199. 10.200.0.0/16 is left for the host daemon's own default-address-pools. docker_up
# refuses a space that overlaps a route of this machine.
POOL_OCTETS = list(range(201, 256)) + list(range(128, 200))
# R-51: the room's label on the host daemon's objects (the private daemon, its volume, the data-root helpers); empty for
# Dev Containers and the conformance runner


def labels():
    return ["--label", LABEL] if LABEL else []


SEED = ["mcr.microsoft.com/devcontainers/base:ubuntu", "mcr.microsoft.com/devcontainers/base:alpine", "alpine:latest"]


def address_pool(slot):
    """(pool, bip) of a slot's private daemon: the slot's /16, split in /24s, with its last /24 as the default bridge."""
    slot = int(slot)
    if not 1 <= slot <= len(POOL_OCTETS):
        raise ValueError(f"slot {slot} has no private-daemon address pool (slots 1..{len(POOL_OCTETS)})")
    o = POOL_OCTETS[slot - 1]
    return f"10.{o}.0.0/16", f"10.{o}.255.1/24"


def host_routes():
    """(destination, device) of every IPv4 route of the machine this runs on (default routes left out)."""
    out = subprocess.run(["ip", "-4", "route", "show", "table", "all"], capture_output=True, text=True).stdout
    routes = []
    for line in out.splitlines():
        f = line.split()
        if not f or f[0] in ("default", "broadcast", "local", "unreachable", "prohibit", "blackhole", "multicast"):
            continue
        if f[0] in ("unicast",):
            f = f[1:]
        dev = f[f.index("dev") + 1] if "dev" in f else None
        routes.append((f[0], dev))
    return routes


def route_conflicts(pool, bip, routes=None, own_devs=()):
    """Routes of this machine that overlap the daemon's pool or bridge (its own bridges excepted). Empty = safe."""
    import ipaddress
    nets = [ipaddress.ip_network(pool), ipaddress.ip_interface(bip).network]
    bad = []
    for dest, dev in (host_routes() if routes is None else routes):
        if dev in own_devs:
            continue
        try:
            r = ipaddress.ip_network(dest, strict=False)
        except ValueError:
            continue
        if any(r.overlaps(n) for n in nets):
            bad.append(f"{dest} dev {dev}")
    return bad


# data-root copies need GNU tar (overlay whiteouts and trusted.* xattrs); docker:dind only has busybox tar
TAR_IMAGE = "mcr.microsoft.com/devcontainers/base:ubuntu"
GITCONFIG = "[user]\n\tname = Lab User\n\temail = lab-user@example.invalid\n[init]\n\tdefaultBranch = main\n"


# Management commands always talk to the host's Docker, even when called from a shell of an isolated run.
HOST_ENV = {k: v for k, v in os.environ.items() if k not in ("DOCKER_HOST", "DOCKER_CONTEXT")}


def sh(*cmd, env=None, check=False):
    return subprocess.run(list(cmd), capture_output=True, text=True, env=env or HOST_ENV, check=check)


def restore_data_root(volume, tarball):
    """Fill a fresh volume with a copy of a golden Docker data root (a tarball made by save_data_root)."""
    tarball = os.path.abspath(tarball)
    sh("docker", "volume", "create", *labels(), volume, check=True)
    sh("docker", "run", "--rm", *labels(), "--privileged", "-v", f"{volume}:/dst", "-v", f"{os.path.dirname(tarball)}:/in:ro",
       "--entrypoint", "tar", TAR_IMAGE, "--xattrs", "--xattrs-include=*", "--numeric-owner", "-xzpf",
       f"/in/{os.path.basename(tarball)}", "-C", "/dst", check=True)


def save_data_root(volume, tarball):
    """Write a stopped daemon's data root (a volume) as a tarball owned by the calling user."""
    tarball = os.path.abspath(tarball)
    sh("docker", "run", "--rm", *labels(), "--privileged", "-v", f"{volume}:/src:ro", "-v", f"{os.path.dirname(tarball)}:/out",
       "--entrypoint", "sh", TAR_IMAGE, "-c",
       f"tar --xattrs --xattrs-include='*' --numeric-owner --sort=name -I 'gzip -1' -cpf /out/{os.path.basename(tarball)} "
       f"-C /src . && chown {os.getuid()}:{os.getgid()} /out/{os.path.basename(tarball)}", check=True)


def docker_up(fid, slot, data_root=None, daemon_args=(), seed=None):
    name, port = f"labdind-{fid}", 23750 + int(slot)
    pool, bip = address_pool(slot)
    bad = route_conflicts(pool, bip)
    if bad:  # R-39: never start a daemon whose networks would shadow a route of this machine (the LAN, the NAS, ...)
        raise RuntimeError(f"R-39: slot {slot}'s private daemon space {pool} (bridge {bip}) overlaps routes here: {', '.join(bad)}")
    docker_down(fid)
    if data_root:
        restore_data_root(name, data_root)
    elif LABEL:   # R-51: the data volume exists, labelled, before the run that mounts it
        sh("docker", "volume", "create", *labels(), name, check=True)
    sh("docker", "run", "-d", *labels(), "--privileged", "--name", name, "--label", f"lab.isolation={fid}",
       "-e", "DOCKER_TLS_CERTDIR=", "-p", f"127.0.0.1:{port}:2375",
       "-v", f"{name}:/var/lib/docker", "-v", f"{WS}:{WS}", "docker:dind", f"--bip={bip}",
       "--default-address-pool", f"base={pool},size=24", *daemon_args, check=True)
    host = f"tcp://127.0.0.1:{port}"
    env = dict(HOST_ENV, DOCKER_HOST=host)
    for _ in range(120):
        if sh("docker", "info", env=env).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError(f"private Docker daemon for {fid} did not start")
    os.makedirs(f"{ISO}/{fid}", exist_ok=True)
    sock = f"{ISO}/{fid}/docker.sock"
    relay = ["socat", f"UNIX-LISTEN:{sock},fork,unlink-early,mode=600", f"TCP:127.0.0.1:{port}"]
    if os.environ.get("ENCODE_NO_SYSTEMD"):  # the standalone runner on a CI machine without a user systemd
        pid = subprocess.Popen(relay, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).pid
        open(f"{ISO}/{fid}/relay.pid", "w").write(str(pid))
    else:
        sh("systemd-run", "--user", f"--unit=labdind-relay-{fid}", "--collect", "-q", *relay, check=True)
    for _ in range(20):
        if os.path.exists(sock):
            break
        time.sleep(0.5)
    if data_root:  # the golden data root already holds its images
        return {"DOCKER_HOST": host, "LAB_DOCKER_SOCK": sock}
    have = set(sh("docker", "images", "--format", "{{.Repository}}:{{.Tag}}").stdout.split())
    for img in (SEED if seed is None else seed):   # seed: an explicit list (the encode fixture builder)
        if img in have:
            save = subprocess.Popen(["docker", "save", img], stdout=subprocess.PIPE, env=HOST_ENV)
            subprocess.run(["docker", "load", "-q"], stdin=save.stdout, env=env, capture_output=True)
            save.wait()
    return {"DOCKER_HOST": host, "LAB_DOCKER_SOCK": sock}


def docker_down(fid):
    name = f"labdind-{fid}"
    if os.path.exists(f"{ISO}/{fid}/relay.pid"):
        try:
            os.killpg(int(open(f"{ISO}/{fid}/relay.pid").read()), 15)
        except (OSError, ValueError):
            pass
    else:
        sh("systemctl", "--user", "stop", f"labdind-relay-{fid}")
    shutil.rmtree(f"{ISO}/{fid}", ignore_errors=True)
    sh("docker", "rm", "-f", "-v", name)
    sh("docker", "volume", "rm", "-f", name)
