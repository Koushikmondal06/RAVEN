#!/usr/bin/env bash
# One-shot host setup for the Firecracker microVM tier — the only tier RAVEN rents. Installs
# firecracker + jailer, fetches a guest kernel, creates the state dirs, and sets up guest NAT.
# Idempotent: safe to re-run. Run once per contributor host, then start the daemon.
#
#   sudo bash contributor/scripts/setup-firecracker.sh
set -euo pipefail

FC_VERSION="${FC_VERSION:-v1.13.1}"
STATE_DIR="${FC_STATE:-/var/lib/raven}"
KERNEL="${FC_KERNEL:-$STATE_DIR/vmlinux}"
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
GUEST_NET="172.31.0.0/16"          # the /30s fc-up.sh hands out come from here
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

# firecracker publishes x86_64 and aarch64. Normalize first: Linux says aarch64/x86_64 but macOS says
# arm64, and rejecting that name would hide the real reason this host can't work (no KVM) behind an
# "unsupported arch" error.
case "$(uname -m)" in
  x86_64|amd64)   ARCH=x86_64 ;;
  aarch64|arm64)  ARCH=aarch64 ;;
  *) echo "unsupported arch $(uname -m) (firecracker ships x86_64 and aarch64)"; exit 1 ;;
esac

# --- the one thing no script can fix ------------------------------------------------------------
# /dev/kvm is the arch-neutral test. vmx/svm is an x86-only CPU flag — aarch64 hosts (Graviton metal,
# ARM bare metal) never report it, so gating on the flag would refuse hosts Firecracker supports.
if [ ! -e /dev/kvm ]; then
  if [ "$ARCH" = "x86_64" ] && ! grep -Eq '\b(vmx|svm)\b' /proc/cpuinfo 2>/dev/null; then
    echo "This host's CPU exposes no hardware virtualization (no vmx/svm in /proc/cpuinfo)." >&2
  else
    echo "No /dev/kvm on this host. Try: modprobe kvm_intel (or kvm_amd). If that fails, the" >&2
    echo "hypervisor is hiding KVM from this guest." >&2
  fi
  cat >&2 <<'MSG'

Firecracker needs KVM. It cannot run on macOS, on Apple silicon under Colima/Lima, or on a standard
cloud VM that hides nested virtualization (e.g. DigitalOcean droplets). Use one of:
  - bare metal (Hetzner / OVH dedicated, your own box)
  - AWS EC2 *.metal instances (x86_64 or Graviton)
  - GCP with nested virtualization enabled on the image
The RAVEN registry, MongoDB and the web app are happy on an ordinary VM — only the contributor
daemon needs KVM.
MSG
  exit 1
fi
[ -r /dev/kvm ] && [ -w /dev/kvm ] || { echo "/dev/kvm is not read/writable — run as root or join the kvm group"; exit 1; }

# curl-or-wget: minimal server images ship one but rarely both.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  echo "need curl or wget"; exit 1
fi

# --- host packages ------------------------------------------------------------------------------
# iproute2 = the tap, e2fsprogs = mkfs.ext4 for the rootfs, nftables = the per-lease egress firewall.
NEED_PKGS=(iproute2 e2fsprogs nftables)
MISSING=()
command -v ip        >/dev/null 2>&1 || MISSING+=(iproute2)
command -v mkfs.ext4 >/dev/null 2>&1 || MISSING+=(e2fsprogs)
command -v nft       >/dev/null 2>&1 || MISSING+=(nftables)
if [ ${#MISSING[@]} -gt 0 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "installing: ${MISSING[*]} …"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${MISSING[@]}"
  else
    echo "no apt-get here — install these with your package manager first: ${NEED_PKGS[*]}" >&2
    exit 1
  fi
fi
command -v docker >/dev/null 2>&1 || {
  echo "docker is required (the sandbox image is built with it, then exported to ext4)" >&2; exit 1; }

# --- firecracker + jailer -----------------------------------------------------------------------
if command -v firecracker >/dev/null 2>&1 && command -v jailer >/dev/null 2>&1; then
  echo "firecracker + jailer already installed: $(firecracker --version 2>&1 | head -1)"
else
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  TGZ="$TMP/fc.tgz"
  URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"
  echo "downloading firecracker ${FC_VERSION} for ${ARCH} …"
  fetch "$URL" "$TGZ"
  tar -xzf "$TGZ" -C "$TMP"
  install -m 0755 "$TMP/release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker
  install -m 0755 "$TMP/release-${FC_VERSION}-${ARCH}/jailer-${FC_VERSION}-${ARCH}"      /usr/local/bin/jailer
  echo "installed $(firecracker --version 2>&1 | head -1)"
fi

# --- guest kernel -------------------------------------------------------------------------------
mkdir -p "$STATE_DIR/rootfs" "$STATE_DIR/slots" "$CHROOT_BASE"
if [ -s "$KERNEL" ]; then
  echo "guest kernel already present at $KERNEL"
else
  # Firecracker's CI kernels: uncompressed vmlinux with virtio + IP autoconfig, which is what the
  # ip= boot arg in fc-up.sh needs. Override FC_KERNEL to use your own build instead.
  K_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.12/${ARCH}/vmlinux-6.1.152"
  echo "downloading guest kernel → $KERNEL"
  fetch "$K_URL" "$KERNEL" || {
    echo "kernel download failed. Build or copy an uncompressed vmlinux to $KERNEL, or set FC_KERNEL." >&2
    exit 1; }
fi

# --- guest networking ---------------------------------------------------------------------------
# Each lease gets a host-local /30 on its own tap. Without forwarding + NAT the guest has no route
# out at all — not even for traffic the per-lease egress allowlist permits.
sysctl -qw net.ipv4.ip_forward=1
printf 'net.ipv4.ip_forward = 1\n' > /etc/sysctl.d/99-raven.conf

# A dedicated table so this never fights the per-lease `raven_<leaseId>` filter tables the daemon
# writes and deletes (contributor/src/net/nft.ts).
nft -f - <<NFT
table ip raven_nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr ${GUEST_NET} counter masquerade
  }
}
NFT
mkdir -p /etc/raven
cat > /etc/raven/nat.nft <<NFT
#!/usr/sbin/nft -f
# Re-apply RAVEN's guest NAT after a reboot: nft -f /etc/raven/nat.nft
table ip raven_nat
delete table ip raven_nat
table ip raven_nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr ${GUEST_NET} counter masquerade
  }
}
NFT
echo "guest NAT installed (table ip raven_nat); re-apply after reboot with: nft -f /etc/raven/nat.nft"

# --- verify -------------------------------------------------------------------------------------
echo
if bash "$HERE/preflight-microvm.sh"; then
  cat <<MSG

Firecracker is ready. Next:
  1. cp contributor/.env.example contributor/.env
  2. set RAVEN_KEY (from the web app's Contribute page) and REGISTRY_URL
  3. sudo -E npm run contributor          # the daemon needs root for tap + loop-mount

The node registers as the 'microvm' tier and is rentable in the marketplace.
MSG
else
  echo "preflight reported problems — fix those, then re-run this script." >&2
  exit 1
fi
