#!/usr/bin/env bash
# Everything a contributor needs, in one command:
#
#   sudo bash contributor/scripts/quickstart.sh rvn_ctb_… https://registry.example
#
# Installs gVisor (runsc) if missing, writes contributor/.env, installs deps, starts the daemon.
# Safe to re-run: every step checks before it acts, and an existing .env keeps its custom settings.
set -euo pipefail

KEY="${1:-${RAVEN_KEY:-}}"
REGISTRY="${2:-${REGISTRY_URL:-http://localhost:4000}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$ROOT/contributor/.env"

die() { echo "✗ $*" >&2; exit 1; }

[ -n "$KEY" ] || die "usage: sudo bash $0 <RAVEN_KEY> [REGISTRY_URL]
       Get the key from the Contribute page of the marketplace, after wallet sign-in."
case "$KEY" in rvn_ctb_*) ;; *) die "that does not look like a RAVEN_KEY (expected rvn_ctb_…)";; esac
[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash $0 $KEY $REGISTRY"
[ "$(uname -s)" = "Linux" ] || die "a rentable node needs Linux — gVisor cannot run on $(uname -s)."
command -v docker >/dev/null || die "docker is not installed (https://docs.docker.com/engine/install/)"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable — start it and re-run"
command -v node >/dev/null || die "node 22+ is not installed (https://nodejs.org)"

echo "→ 1/4 gVisor"
bash "$HERE/setup-gvisor.sh"

echo "→ 2/4 config"
if [ -f "$ENV_FILE" ]; then
  # Replace only the two lines we own; anything the operator tuned (rate, label, egress) survives.
  sed -i -e "s|^RAVEN_KEY=.*|RAVEN_KEY=$KEY|" -e "s|^REGISTRY_URL=.*|REGISTRY_URL=$REGISTRY|" "$ENV_FILE"
  grep -q '^RAVEN_KEY=' "$ENV_FILE" || echo "RAVEN_KEY=$KEY" >> "$ENV_FILE"
  grep -q '^REGISTRY_URL=' "$ENV_FILE" || echo "REGISTRY_URL=$REGISTRY" >> "$ENV_FILE"
  echo "  updated $ENV_FILE"
else
  printf 'RAVEN_KEY=%s\nREGISTRY_URL=%s\nSANDBOX_BACKEND=gvisor\n' "$KEY" "$REGISTRY" > "$ENV_FILE"
  echo "  wrote $ENV_FILE"
fi

echo "→ 3/4 dependencies"
( cd "$ROOT" && npm install --silent )

echo "→ 4/4 starting the daemon — your node appears in the marketplace within ~10s"
echo "  (Ctrl-C stops it; re-run this script any time)"
cd "$ROOT" && exec npm run contributor
