#!/bin/bash
# Generate a localhost TLS cert pair for `npm run dev:https` into ./certs.
# Uses mkcert (locally trusted, no browser warning) when available, otherwise
# falls back to a self-signed openssl cert (browser warns once).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs

if [ -f certs/localhost.pem ] && [ -f certs/localhost-key.pem ]; then
  echo "certs/ already present - delete them to regenerate."
  exit 0
fi

if command -v mkcert >/dev/null 2>&1; then
  mkcert -install >/dev/null 2>&1 || true
  mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
  echo "Generated locally-trusted cert with mkcert."
else
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout certs/localhost-key.pem -out certs/localhost.pem \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  echo "Generated self-signed cert (openssl). Browsers will show a one-time warning."
  echo "Install mkcert (brew install mkcert) and re-run for a trusted cert."
fi
