#!/bin/sh
set -e
[ -n "$ROOT_PASSWORD" ] || { echo "ROOT_PASSWORD not set"; exit 1; }
echo "root:$ROOT_PASSWORD" | chpasswd
ssh-keygen -A
exec /usr/sbin/sshd -D -e
