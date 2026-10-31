#!/bin/sh
# Runs shapes.sh in each userland our host-side scripts meet and prints the shapes whose result differs.
#
#     tools/host-shapes/run.sh [image ...]
#
# The default images: Ubuntu 26.04 (uutils coreutils), Debian bookworm (GNU coreutils) and the Alpine of the acceptance
# runs (busybox). docs/architecture/host-command-shapes.md says what each shape is and where our scripts use it.
set -u
here=$(cd "$(dirname "$0")" && pwd)
[ "$#" -gt 0 ] || set -- ubuntu:26.04 debian:bookworm-slim alpine:3.22
work=$(mktemp -d) || exit 1
for image in "$@"; do
  file=$work/$(printf '%s' "$image" | tr ':/' '__')
  docker run --rm -i "$image" sh -s <"$here/shapes.sh" >"$file" 2>&1 || echo "run.sh: $image exited with $?" >&2
done
first=$1
shift
for image in "$@"; do
  echo "== $first against $image"
  diff "$work/$(printf '%s' "$first" | tr ':/' '__')" "$work/$(printf '%s' "$image" | tr ':/' '__')" || true
done
rm -rf "$work"
