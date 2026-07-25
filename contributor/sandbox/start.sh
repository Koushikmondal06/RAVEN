#!/bin/sh
set -e

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
  # Key-only: no password auth, root may log in only with a key.
  [ -n "$SSH_PUBKEY" ] || { echo "neither SSH_PUBKEY nor ROOT_PASSWORD set"; exit 1; }
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
fi

# Guest hard-TTL backstop (phase 8): power off after SANDBOX_TTL seconds no matter what the
# registry does, so a dropped registry never leaves a sandbox running for free.
if [ -n "$SANDBOX_TTL" ] && [ "$SANDBOX_TTL" -gt 0 ] 2>/dev/null; then
  (sleep "$SANDBOX_TTL"; echo "TTL reached, shutting down"; kill -TERM 1) &
fi

ssh-keygen -A
exec /usr/sbin/sshd -D -e
