#!/usr/bin/env bash
# The podman launch's deadlock without VSCodium (#2319): a container run attached as the dev container CLI runs it, a
# long-lived exec with its stdin held open (the CLI's shell server), and short execs beside it, under several options.
set +e
now() { date +%s.%N; }
t() { local s=$1; shift; local start; start=$(now); timeout "$s" "$@"; local rc=$?; echo "  -> exit $rc after $(awk -v a="$start" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}') s"; }
IMAGE=docker.io/library/alpine:3.22
scenario() {
  local name=$1; shift
  local P=("$@")
  echo "##### $name: $("${P[@]}" --version 2>&1)"
  t 60 "${P[@]}" system reset -f >/dev/null 2>&1
  t 30 "${P[@]}" info --format 'storage {{.Store.GraphDriverName}} db {{.Host.DatabaseBackend}} cgroup {{.Host.CgroupManager}} events {{.Host.EventLogger}} runtime {{.Host.OCIRuntime.Path}} rootless {{.Host.Security.Rootless}}'
  t 120 "${P[@]}" pull -q "$IMAGE" >/dev/null
  echo "-- the container, run attached as the CLI does"
  ( timeout 900 "${P[@]}" run --sig-proxy=false -a STDOUT -a STDERR --name "repro-$name" "$IMAGE" sh -c 'echo started; while sleep 1; do :; done' >"$RUNNER_TEMP/run-$name.out" 2>&1 ) &
  local runner=$!
  for _ in $(seq 1 40); do [ "$(timeout 10 "${P[@]}" inspect -f '{{.State.Running}}' "repro-$name" 2>/dev/null)" = true ] && break; sleep 1; done
  echo "running: $(timeout 10 "${P[@]}" inspect -f '{{.State.Running}}' "repro-$name" 2>&1)"
  echo "-- A: one short exec with a piped script, as the CLI's"
  local script='echo short-exec'
  printf '%s' "$script" | t 30 "${P[@]}" exec -i --user root "repro-$name" sh -c "eval \"\$(dd bs=1 count=${#script} 2>/dev/null)\""
  echo "-- B: four short execs at once"
  local pids=()
  for k in 1 2 3 4; do
    ( s="echo exec-$k"; printf '%s' "$s" | t 60 "${P[@]}" exec -i --user root "repro-$name" sh -c "eval \"\$(dd bs=1 count=${#s} 2>/dev/null)\"" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  echo "-- C: a long-lived exec whose stdin stays open (the shell server), then short execs beside it"
  ( sleep 240 | timeout 300 "${P[@]}" exec -i --user root "repro-$name" sh -c 'echo server-up; cat >/dev/null' >"$RUNNER_TEMP/server-$name.out" 2>&1 ) &
  local server=$!
  sleep 5
  echo "server: $(cat "$RUNNER_TEMP/server-$name.out" 2>/dev/null)"
  printf '%s' "$script" | t 60 "${P[@]}" exec -i --user root "repro-$name" sh -c "eval \"\$(dd bs=1 count=${#script} 2>/dev/null)\""
  pids=()
  for k in 1 2 3; do
    ( s="echo beside-$k"; printf '%s' "$s" | t 60 "${P[@]}" exec -i --user root "repro-$name" sh -c "eval \"\$(dd bs=1 count=${#s} 2>/dev/null)\"" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  echo "-- D: the engine still answers"
  t 20 "${P[@]}" ps -a --format '{{.Names}} {{.State}}'
  t 20 "${P[@]}" system locks
  echo "-- the processes left"
  ps -eo pid,ppid,stat,etime,wchan:20,args | grep -E '[/ ]podman |[c]onmon ' | cut -c1-220 | head -20
  kill "$server" "$runner" 2>/dev/null
  pkill -f "sleep 240" 2>/dev/null
  t 60 "${P[@]}" rm -f -t 0 "repro-$name" >/dev/null 2>&1
  sleep 2
}
scenario ubuntu-apt /usr/bin/podman
scenario static podman
mkdir -p "$HOME/.config/containers"
printf '[engine]\nevents_logger = "none"\n' > "$HOME/.config/containers/containers.conf"
scenario static-events-none podman
rm -f "$HOME/.config/containers/containers.conf"
printf '[storage]\ndriver = "vfs"\n' > "$HOME/.config/containers/storage.conf"
scenario static-vfs podman
rm -f "$HOME/.config/containers/storage.conf"
scenario static-rootful sudo /usr/local/bin/podman
