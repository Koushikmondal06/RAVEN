#!/usr/bin/env bash
# One-shot gVisor (runsc) setup for the usermode-kernel tier — a real virtualized kernel with NO KVM
# needed, so it works on ordinary cloud VMs. Installs runsc, registers it as a Docker runtime, and
# restarts Docker. Run once on the host, then run the contributor with SANDBOX_BACKEND=gvisor.
#   sudo bash contributor/scripts/setup-gvisor.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q runsc; then
  echo "runsc is already registered as a Docker runtime — nothing to do."
  exit 0
fi

ARCH="$(uname -m)"        # gVisor publishes x86_64 and aarch64
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "downloading runsc + shim for ${ARCH} …"
wget -q --show-progress "${URL}/runsc" "${URL}/runsc.sha512" \
     "${URL}/containerd-shim-runsc-v1" "${URL}/containerd-shim-runsc-v1.sha512" -P "$TMP"

( cd "$TMP" && sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512 )
install -m 0755 "$TMP/runsc" "$TMP/containerd-shim-runsc-v1" /usr/local/bin/

# `runsc install` adds the runsc runtime to /etc/docker/daemon.json.
runsc install
systemctl restart docker

echo
docker info --format '{{json .Runtimes}}' | grep -q runsc \
  && echo "gVisor ready. Run the contributor with SANDBOX_BACKEND=gvisor." \
  || { echo "runsc did not register — check /etc/docker/daemon.json and 'systemctl status docker'"; exit 1; }
