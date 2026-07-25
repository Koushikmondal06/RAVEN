#!/usr/bin/env bash
# Build an ext4 rootfs from the sandbox OCI image, cached by image digest so repeat lease starts are
# fast. UNVERIFIED skeleton — paths and sizes are host-tunable.
set -euo pipefail
IMAGE="$1"; CONTEXT="$2"
CACHE_DIR="${FC_CACHE_DIR:-/var/lib/raven/rootfs}"
mkdir -p "$CACHE_DIR"

# Ensure the image exists (built into Docker's store; export works from there).
docker build -t "$IMAGE" "$CONTEXT" >/dev/null

DIGEST="$(docker image inspect "$IMAGE" --format '{{.Id}}' | sed 's/sha256://')"
EXT4="$CACHE_DIR/$DIGEST.ext4"
[ -f "$EXT4" ] && { echo "$EXT4"; exit 0; }   # cache hit

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CID="$(docker create "$IMAGE")"
docker export "$CID" | tar -x -C "$TMP"
docker rm "$CID" >/dev/null

# Size the image to the rootfs plus headroom, then build ext4 directly from the directory.
SIZE_MIB=$(( $(du -sm "$TMP" | cut -f1) + 256 ))
mkfs.ext4 -q -F -d "$TMP" "$EXT4" "${SIZE_MIB}M"
echo "$EXT4"
