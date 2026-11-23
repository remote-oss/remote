#!/bin/sh
# The T.6 spike's certificate (card #3050): a self-signed certificate for the relay's names, which the run also trusts
# as its authority (NODE_EXTRA_CA_CERTS, SSL_CERT_FILE). Usage: cert.sh <folder>. Prints the TLS_CERT and TLS_KEY lines.
# The names are localhost, cp.localhost, *.localhost and 127.0.0.1. Node and the Rust host resolved cp.localhost to the
# loopback locally; where a resolver doesn't, add "127.0.0.1 cp.localhost" to /etc/hosts.
set -eu
folder=$1
mkdir -p "$folder"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:cp.localhost,DNS:*.localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -keyout "$folder/key.pem" -out "$folder/cert.pem" 2>/dev/null
chmod 644 "$folder/cert.pem"
chmod 600 "$folder/key.pem"
echo "TLS_CERT=$folder/cert.pem"
echo "TLS_KEY=$folder/key.pem"
