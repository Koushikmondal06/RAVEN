#!/usr/bin/env bash
# Checks whether this host can run the microvm (Kata + Firecracker) tier. Prints one actionable line
# per failure and exits non-zero if any hard requirement is missing.
set -u
fail=0
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

echo "RAVEN microvm preflight"

# 1. CPU virtualization
if grep -Eq '\b(vmx|svm)\b' /proc/cpuinfo; then ok "cpu virtualization (vmx/svm) present"
else bad "no vmx/svm in /proc/cpuinfo — enable VT-x/AMD-V, or this instance has no nested virt"; fi

# 2. /dev/kvm usable by this user
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then ok "/dev/kvm is read/writable"
else bad "/dev/kvm missing or not read/writable — add the daemon user to the 'kvm' group; note standard DigitalOcean droplets do not expose /dev/kvm"; fi

# 3. containerd + version
if command -v containerd >/dev/null 2>&1; then ok "containerd: $(containerd --version 2>/dev/null | awk '{print $3}')"
else bad "containerd not installed"; fi

# 4. kata-fc shim
if command -v containerd-shim-kata-fc-v2 >/dev/null 2>&1; then ok "containerd-shim-kata-fc-v2 on PATH"
else bad "containerd-shim-kata-fc-v2 not on PATH — install Kata Containers and configure the kata-fc runtime"; fi

# 5. firecracker binary
if command -v firecracker >/dev/null 2>&1; then ok "firecracker: $(firecracker --version 2>/dev/null | head -1)"
else bad "firecracker binary not on PATH"; fi

# 6. nerdctl (used to build/run through containerd)
if command -v nerdctl >/dev/null 2>&1; then ok "nerdctl on PATH"
else bad "nerdctl not on PATH — needed to build/run the image in containerd's store"; fi

echo
if [ "$fail" -eq 0 ]; then echo "microvm tier: READY"; else echo "microvm tier: NOT READY (fix the FAIL lines above)"; fi
exit "$fail"
