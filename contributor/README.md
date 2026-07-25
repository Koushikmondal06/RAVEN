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
> Each lease is a hardened Docker container — no host filesystem, `no-new-privileges`, capped
> CPU/RAM/PIDs — but it **shares your host's kernel**. A kernel
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
| **Outbound internet** | each lease's SSH port is published over a [bore](https://github.com/ekzhang/bore) tunnel to the marketplace's relay | no inbound ports to open; the registry tells your daemon which relay to use |
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
| `BORE_SERVER` | `bore.pub` | **fallback only** — the registry pushes its own relay at register time and that wins. Set this only when running against a registry that has none. |
| `BORE_SECRET` | — | ditto; the registry supplies it for its own relay |
| `REAP_INTERVAL_MS` | `60000` | orphan-sandbox reaper period |
| `KILL_PORT` | `4999` | local-only kill switch port |

`REQUIRE_SSH_KEY=true` (on the **registry**, not here) forces buyers to supply an SSH public key. Off
by default: a lease's root password is the buyer's wallet address, which is public — so assume anyone
can reach a live lease, and that the sandbox is the only thing protecting your host.

## Safety model, briefly

- **The daemon holds no wallet** — only the `RAVEN_KEY` bearer. Payouts are signed server-side by the
  registry, never on this box.
- **The lease is contained by Docker, and only by Docker**: no host filesystem mounted,
  `no-new-privileges`, capped CPU/RAM/PIDs. (`--cap-drop=ALL` and `--read-only` are not used: the
  sandbox writes sshd's host keys and the root password at boot, so either flag kills the lease.)
  The kernel is shared with your host — that is the boundary's ceiling, and it is why you should not
  run this on a machine that matters to you.
- **Credentials are per lease** — the injected key or password dies with the container, so one
  buyer's access can't reach the next lease. Note the default password is the buyer's public wallet
  address, so a live lease should be assumed reachable by third parties; the container boundary, not
  the password, is what protects your machine.
- **Teardown is guaranteed:** the sandbox self-destructs at a hard TTL, and a reaper reconciles live
  containers against known leases every `REAP_INTERVAL_MS`, removing both the sandbox and its tunnel.
- **The Docker socket mount is host root.** For a longer-lived setup, see
  [docs/daemon-isolation.md](docs/daemon-isolation.md).
