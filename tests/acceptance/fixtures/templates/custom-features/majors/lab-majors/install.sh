#!/bin/sh
set -e
# The version this copy of the Feature was published at, read from the metadata beside this script.
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$(dirname "$0")/devcontainer-feature.json" | head -n 1)
major=${version%%.*}
mkdir -p /usr/local/share/remote-oss-run
echo "$version" > "/usr/local/share/remote-oss-run/lab-majors-$major"
