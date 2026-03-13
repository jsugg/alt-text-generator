#!/usr/bin/env bash
set -euo pipefail

ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.11}"
ACTIONLINT_SHA256="${ACTIONLINT_SHA256:-900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a}"
ACTIONLINT_ARCHIVE="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
ACTIONLINT_URL="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${ACTIONLINT_ARCHIVE}"
ACTIONLINT_OUTPUT="${ACTIONLINT_OUTPUT:-/tmp/actionlint.tar.gz}"
ACTIONLINT_BIN_DIR="${ACTIONLINT_BIN_DIR:-/tmp}"

curl --fail --silent --show-error --location --output "${ACTIONLINT_OUTPUT}" "${ACTIONLINT_URL}"
echo "${ACTIONLINT_SHA256}  ${ACTIONLINT_OUTPUT}" | sha256sum --check --
tar -xzf "${ACTIONLINT_OUTPUT}" -C "${ACTIONLINT_BIN_DIR}" actionlint
