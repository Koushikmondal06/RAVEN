#!/bin/sh
set -e

# The sandbox entrypoint: the CMD of the lease's container. The mount/env fallbacks below exist
# because this script also booted as PID 1 of a Firecracker guest in an earlier revision; each one is
# a no-op when a container runtime has already done the work.

# Kernel filesystems — a container gets these from the runtime.
mountpoint -q /proc 2>/dev/null || mount -t proc proc /proc 2>/dev/null || true
mountpoint -q /sys 2>/dev/null || mount -t sysfs sysfs /sys 2>/dev/null || true
mountpoint -q /dev 2>/dev/null || mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mkdir -p /dev/pts 2>/dev/null || true
mountpoint -q /dev/pts 2>/dev/null || mount -t devpts devpts /dev/pts 2>/dev/null || true

# The container receives SSH_PUBKEY / SANDBOX_TTL as env vars. The file fallback is harmless legacy.
if [ -f /etc/raven-net.env ]; then . /etc/raven-net.env; fi

# SSH key is the default. A password is only accepted when the registry explicitly sent one
# (ALLOW_PASSWORD_SSH), and even then key auth stays on.
if [ -n "$SSH_PUBKEY" ]; then
  mkdir -p /root/.ssh
  printf '%s\n' "$SSH_PUBKEY" > /root/.ssh/authorized_keys
  chmod 700 /root/.ssh
  chmod 600 /root/.ssh/authorized_keys
fi

if [ -n "$ROOT_PASSWORD" ]; then
  echo "root:$ROOT_PASSWORD" | chpasswd
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
else
  # Key-only: no password auth, root may log in only with a key. fc-up.sh writes authorized_keys
  # directly into the per-lease rootfs, so in the VM the file can exist without SSH_PUBKEY being set.
  [ -n "$SSH_PUBKEY" ] || [ -s /root/.ssh/authorized_keys ] || {
    echo "no SSH public key and no ROOT_PASSWORD"; exit 1
  }
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
fi

# Guest hard-TTL backstop: shut down after SANDBOX_TTL seconds no matter what the registry does, so a
# dropped registry never leaves a sandbox running for free. In a VM, killing PID 1 alone would only
# panic the guest, so ask the kernel to power off first — Firecracker exits when the guest does.
if [ -n "$SANDBOX_TTL" ] && [ "$SANDBOX_TTL" -gt 0 ] 2>/dev/null; then
  (
    sleep "$SANDBOX_TTL"
    echo "TTL reached, shutting down"
    echo o > /proc/sysrq-trigger 2>/dev/null || reboot -f 2>/dev/null || kill -TERM 1
  ) &
fi

ssh-keygen -A
exec /usr/sbin/sshd -D -e
