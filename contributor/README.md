# Become a RAVEN contributor

Share a machine's spare compute; get paid in SOL by the second. The daemon registers your host with a
RAVEN backend, and when a buyer rents it, starts a throwaway Docker container they `ssh` into. At
lease end you're paid on-chain automatically.

You run **one container** (this daemon). No wallet, no inbound ports, no private key on the box.

## The whole setup

```bash
git clone <this repo> raven && cd raven
printf 'RAVEN_KEY=rvn_ctb_…\nREGISTRY_URL=https://api.raven.example\n' > contributor/.env
docker compose up -d --build contributor
docker compose logs -f contributor      # "registered with … as <node id>"
```

Your node appears in the marketplace's Explore table within ~10 seconds. Get the `rvn_ctb_…` key from
[Step 1](#step-1--get-your-raven_key); the URL comes from whoever runs the marketplace.

> ### Read this before you run it
>
> Each lease is a hardened Docker container — no host filesystem, all capabilities dropped, read-only
> root, `no-new-privileges`, capped CPU/RAM/PIDs — but it **shares your host's kernel**. A kernel
> exploit from inside a lease lands on your machine. The daemon also mounts the Docker socket so it
> can start those containers, which is equivalent to giving it root on the host.
>
> Run this on a machine you are willing to hand to strangers: a spare VM or a dedicated box, not your
> laptop and not anything holding credentials.

---

## Requirements

| Need | Why | Notes |
|---|---|---|
| **Docker** | the daemon and every lease run as containers | `docker ps` must work; Compose v2 (`docker compose`) or v1 (`docker-compose`) |
| **Outbound internet** | each lease's SSH port is published over a [bore](https://github.com/ekzhang/bore) tunnel | no inbound ports to open |
| **`RAVEN_KEY` + backend URL** | authenticates the node; where payouts go | key from the web app (Step 1); URL from the marketplace operator |

Linux is the sane host. macOS works for development through Docker Desktop or Colima, but the SSH
tunnel and the reaper both assume a long-lived machine — don't expect a laptop to earn.

---

## Start a node

### Step 1 — Get your `RAVEN_KEY`

1. Open the marketplace web app and flip the switch to **Contribute** (or go straight to `/contributor`).
2. **Connect Wallet** (Phantom / Solflare / Backpack) → **Sign in** (you sign a one-time nonce,
   nothing on-chain).
3. Click **Create key** and copy the `rvn_ctb_…` key. It's tied to your wallet; payouts go there. The
   daemon sends only this key — the backend resolves it to your payout address server-side. You can
   hold **two keys** at once (roll one while the other still runs) and revoke either from the same page.

### Step 2 — Configure

```bash
cp contributor/.env.example contributor/.env
```

```ini
RAVEN_KEY=rvn_ctb_…                     # from Step 1
REGISTRY_URL=https://api.raven.example  # your backend
```

Everything else has a default — see [Knobs](#knobs).

### Step 3 — Run

```bash
docker compose up -d --build contributor
```

The service mounts `/var/run/docker.sock`, so each lease starts as a sibling container on your host's
Docker daemon rather than nested inside this one. `restart: unless-stopped` brings it back after a
reboot. To run it natively instead (same behaviour, no socket mount needed since it's already your
daemon):

```bash
npm install && npm run contributor
```

### Step 4 — Verify it's rentable

- `docker compose logs contributor` shows `registered with <url> as <node id>`.
- The node appears in the web app's **Explore** table with a live **Rent** button.
- During a lease, `docker ps` on the host shows `raven-<leaseid>` (the sandbox) and
  `raven-bore-<leaseid>` (its tunnel).

### Stop / panic

- Stop: `docker compose stop contributor`.
- Kill switch — tear down every sandbox at once, locally only:
  ```bash
  curl -X POST http://127.0.0.1:4999/kill      # KILL_PORT, 127.0.0.1 only
  ```

---

## Knobs

Only `RAVEN_KEY` and `REGISTRY_URL` are required. Defaults shown.

| Var | Default | Meaning |
|---|---|---|
| `RAVEN_KEY` | — | **required** — your `rvn_ctb_…` key |
| `REGISTRY_URL` | `http://localhost:4000` | backend to register with |
| `RATE_LAMPORTS_PER_HOUR` | `50000000` | price (0.05 SOL/hour) |
| `NODE_LABEL` | hostname | name shown in Explore |
| `SHARE_CPUS` | cores − 1 | CPUs per lease |
| `SHARE_MEM_MB` | half of RAM | memory per lease |
| `TUNNEL_MODE` | `bore` | `bore` = outbound tunnel, no inbound ports; `local` = reach the container's published port directly (same host/LAN only) |
| `BORE_SERVER` | `bore.pub` | bore relay for `TUNNEL_MODE=bore` |
| `REAP_INTERVAL_MS` | `60000` | orphan-sandbox reaper period |
| `KILL_PORT` | `4999` | local-only kill switch port |

`ALLOW_PASSWORD_SSH=true` (on the **registry**, not here) re-enables the old wallet-address password.
Off by default — SSH is key-only and the buyer supplies the public key.

## Safety model, briefly

- **The daemon holds no wallet** — only the `RAVEN_KEY` bearer. Payouts are signed server-side by the
  registry, never on this box.
- **The lease is contained by Docker, and only by Docker**: no host filesystem mounted, `--cap-drop=ALL`,
  `--read-only` root with `noexec,nosuid` scratch tmpfs, `no-new-privileges`, capped CPU/RAM/PIDs.
  The kernel is shared with your host — that is the boundary's ceiling, and it is why you should not
  run this on a machine that matters to you.
- **The SSH key is injected per lease** and the container is destroyed at the end, so one buyer's key
  can't reach the next lease.
- **Teardown is guaranteed:** the sandbox self-destructs at a hard TTL, and a reaper reconciles live
  containers against known leases every `REAP_INTERVAL_MS`, removing both the sandbox and its tunnel.
- **The Docker socket mount is host root.** For a longer-lived setup, see
  [docs/daemon-isolation.md](docs/daemon-isolation.md).
