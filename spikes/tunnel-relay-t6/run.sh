#!/bin/sh
# The T.6 spike's run (card #3050): the relay, then each host in turn with the client through it, then the readout.
#
# Needs: node (the repository's), the relay's and ts-sdk's node_modules installed, the Rust host built, and a
# certificate for the relay's names. Environment:
#   RELAY_DOMAIN    the domain the hosts and the client use, `cp.` prefixed for management (default localhost:18443)
#   RELAY_PORT      the relay's port (default 18443)
#   TLS_CERT        PEM certificate for cp.<domain> and <domain>, also trusted as the run's authority
#   TLS_KEY         its key
#   RUST_HOST_BIN   the built rust-host binary
# Exit status: 0 when both hosts' legs and pipes are green, 1 otherwise.
set -u

here=$(cd "$(dirname "$0")" && pwd)
domain=${RELAY_DOMAIN:-localhost:18443}
port=${RELAY_PORT:-18443}
log=$(mktemp -d)

# Node trusts the run's authority through NODE_EXTRA_CA_CERTS, the Rust host's OpenSSL through SSL_CERT_FILE.
export NODE_EXTRA_CA_CERTS="$TLS_CERT" SSL_CERT_FILE="$TLS_CERT"

(cd "$here/relay" && RELAY_DOMAIN=${domain%%:*} RELAY_PORT=$port node relay.ts) >"$log/relay.log" 2>&1 &
relay=$!
i=0
until grep -q 'relay: listening' "$log/relay.log" 2>/dev/null; do
  i=$((i + 1))
  if [ $i -gt 50 ]; then
    echo "the relay did not start:"
    cat "$log/relay.log"
    exit 1
  fi
  sleep 0.2
done

# Runs host $1 (ts or rust) on tunnel t6-$1 with echo port $2, waits for its leg, runs the client, stops the host.
run_host() {
  label=$1
  echo_port=$2
  case $label in
    ts) (cd "$here/ts-sdk" && RELAY_DOMAIN=$domain TUNNEL_ID=t6-ts ECHO_PORT=$echo_port node host.ts) >"$log/host-$label.log" 2>&1 & ;;
    rust) RELAY_DOMAIN=$domain TUNNEL_ID=t6-rust ECHO_PORT=$echo_port "$RUST_HOST_BIN" >"$log/host-$label.log" 2>&1 & ;;
  esac
  host=$!
  i=0
  until grep -qE "host leg (t6-$label connected|t6-$label FAILED)" "$log/relay.log"; do
    i=$((i + 1))
    if [ $i -gt 150 ] || ! kill -0 $host 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  (cd "$here/ts-sdk" && RELAY_DOMAIN=$domain TUNNEL_ID=t6-$label ECHO_PORT=$echo_port HOST_LABEL=$label-host timeout 60 node client.ts) >"$log/client-$label.log" 2>&1
  echo "$?" >"$log/client-$label.status"
  kill $host 2>/dev/null
  wait $host 2>/dev/null
}

run_host rust 18091
run_host ts 18092
kill $relay 2>/dev/null
wait $relay 2>/dev/null

for file in relay host-rust host-ts client-rust client-ts; do
  echo "----- $file"
  cat "$log/$file.log"
done

echo "===== RESULT"
green=0
for label in rust ts; do
  leg=$(grep "host leg t6-$label connected" "$log/relay.log" | head -1)
  case $leg in
    *"kex=none hostKey=none cipher=none"*) echo "host leg, $label host: GREEN: ${leg#relay: }" ;;
    *) echo "host leg, $label host: RED: ${leg:-$(grep "host leg t6-$label" "$log/relay.log" | head -1)}"; green=1 ;;
  esac
  if grep -q 'PIPE OK' "$log/client-$label.log"; then
    echo "pipe, $label host: GREEN: $(grep -E 'sent|back|round trip|connected through' "$log/client-$label.log" | sed 's/^client ([a-z-]*): //' | tr '\n' ';')"
  else
    echo "pipe, $label host: RED (client exit $(cat "$log/client-$label.status")): $(tail -1 "$log/client-$label.log")"
    green=1
  fi
  echo "host connect, $label host: $(grep 'host leg connected in' "$log/host-$label.log" | head -1)"
done
echo "trust: Node by NODE_EXTRA_CA_CERTS, the Rust host by SSL_CERT_FILE (OpenSSL, native-tls)"
rm -rf "$log"
exit $green
