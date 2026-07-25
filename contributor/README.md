# Become a RAVEN contributor

Share a machine's spare compute; get paid in SOL by the second. The daemon registers your host with
a RAVEN backend, and when a buyer rents it, launches a hardened, throwaway sandbox they `ssh` into.
At lease end you're paid on-chain automatically.

You run **one process** (this daemon). No wallet, no inbound ports, no private key on the box.

> **A rentable node must run a real isolation tier — gVisor (`usermode-kernel`) or a microVM.**
> The plain `container` tier (shared host kernel) is **below the marketplace minimum and will show
> "Below min" — it cannot be rented.** So there is deliberately no "just run docker" node path here:
> a node is worth running only if it clears the bar. Pick gVisor unless you have KVM.

---

## Requirements

| Need | Why | Notes |
|---|---|---|
| **A Linux host** | gVisor and microVM only run on Linux | **macOS / Colima / Windows cannot run a rentable node** — they can't deliver `runsc` or `/dev/kvm`. Use them for development only. Rent a cheap Linux VM/box for a real node. |
| **Docker** running | the daemon launches each sandbox as a container | `docker ps` must work |
| **`runsc` (for gVisor)** | the `usermode-kernel` boundary | one script installs it (below). This is the recommended tier — **no KVM needed**, runs on ordinary cloud VMs. |
| **`/dev/kvm` (for microVM)** | the `microvm` boundary | only if you go the microVM route — needs bare-metal or a nested-virt instance. Check: `bash contributor/scripts/preflight-microvm.sh` |
| **Node 22+** *or* Docker Compose | to run the daemon | native run is recommended for production |
| **Outbound internet** | each sandbox dials out over a [bore](https://github.com/ekzhang/bore) tunnel | no inbound ports to open |
| **`RAVEN_KEY` + backend URL** | authenticates the node; where payouts go | key from the web app (step 1); URL from the marketplace operator |

Pick your tier:

| Tier | `SANDBOX_BACKEND` | Boundary | Rentable? |
|---|---|---|---|
| `usermode-kernel` | `gvisor` | syscalls intercepted in userspace (runsc) | ✅ **recommended — no KVM** |
| `microvm` | `kata-fc` / `firecracker` | separate guest kernel over KVM | ✅ if you have `/dev/kvm` |
| ~~`container`~~ | ~~`docker`~~ | ~~shared host kernel~~ | ❌ below market minimum |

---

## Start a node

### Step 1 — Get your `RAVEN_KEY`

1. Open the marketplace web app → **Become a Contributor** (`/contributor`).
2. **Connect Wallet** (Phantom / Solflare / Backpack) → **Sign in** (you sign a one-time nonce,
   nothing on-chain).
3. Copy the `rvn_ctb_…` key it shows. It's tied to your wallet; payouts go there. The daemon sends
   only this key — the backend resolves it to your payout address server-side.

### Step 2 — Set up the isolation tier

**gVisor (recommended):**
```bash
sudo bash contributor/scripts/setup-gvisor.sh            # installs runsc, registers the Docker runtime
docker info --format '{{json .Runtimes}}' | grep runsc   # verify runsc is registered
```
Idempotent. Details: [docs/gvisor-setup.md](docs/gvisor-setup.md).

**microVM (only if you have KVM):** see [docs/microvm-setup.md](docs/microvm-setup.md).

### Step 3 — Configure

```bash
cp contributor/.env.example contributor/.env
```
Edit `contributor/.env`:
```ini
RAVEN_KEY=rvn_ctb_…                     # from step 1
REGISTRY_URL=https://api.raven.example  # your backend
SANDBOX_BACKEND=gvisor                  # or kata-fc / firecracker
```
Everything else has a default — see [Knobs](#knobs).

The daemon **refuses to start if the chosen backend isn't available on the host** (e.g. `gvisor`
without `runsc`). It never advertises a tier it can't deliver — so if it starts, it's rentable.

### Step 4 — Run

**Native (recommended — production):**
```bash
npm install
npm run contributor
```
For a long-lived node install the systemd unit
([`systemd/raven-contributor.service`](systemd/raven-contributor.service)) — it confines the daemon
with `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, and a `ReadWritePaths` allowlist. Setup
is in that file's header.

**Docker Compose (quick start):** run from the **repo root** (not `contributor/`):
```bash
docker compose up -d --build contributor
docker compose logs -f contributor
```
The daemon mounts the host Docker socket and launches sandboxes as sibling containers on the host —
so gVisor (`runsc` on the host) works here too. **Caveat:** the socket mount gives the container host
root. Fine for a demo; for a real machine run natively. See [docs/daemon-isolation.md](docs/daemon-isolation.md).

### Step 5 — Verify it's rentable

- Daemon log prints the tier: `registered … isolation=usermode-kernel`.
- In the web app's **Explore** table the node's **Isolation** column reads `gVisor` (not `container`)
  and the **Rent** button is enabled (not "Below min").
- During a lease, `docker ps` shows the sandbox; for gVisor it runs `--runtime=runsc`.

### Stop / panic

- Stop: `Ctrl-C` (native) or `docker compose down` (compose).
- Kill switch — tear down every sandbox at once, locally only:
  ```bash
  curl -X POST http://127.0.0.1:4999/kill      # KILL_PORT, 127.0.0.1 only
  ```

---

## Knobs

All optional except `RAVEN_KEY` / `REGISTRY_URL` / `SANDBOX_BACKEND`. Defaults shown.

| Var | Default | Meaning |
|---|---|---|
| `RAVEN_KEY` | — | **required** — your `rvn_ctb_…` key |
| `REGISTRY_URL` | `http://localhost:4000` | backend to register with |
| `SANDBOX_BACKEND` | `docker` | **set to `gvisor`** (or `kata-fc`/`firecracker`) for a rentable node — `docker` (container) is below the market min. Daemon fails to start if the host can't deliver it. |
| `EGRESS_MODE` | `allowlist` | `allowlist` / `deny-all` / `open` — per-lease egress firewall, advertised to buyers |
| `RATE_LAMPORTS_PER_HOUR` | `50000000` | price (0.05 SOL/hour) |
| `NODE_LABEL` | hostname | name shown in Explore |
| `SHARE_CPUS` | cores − 1 | CPUs offered per lease |
| `SHARE_MEM_MB` | half of RAM | memory offered per lease |
| `TUNNEL_MODE` | `bore` | `bore` = outbound tunnel, no inbound ports; `local` = same-LAN SSH |
| `BORE_SERVER` | `bore.pub` | bore relay for `TUNNEL_MODE=bore` |
| `REAP_INTERVAL_MS` | `60000` | orphan-sandbox reaper period |
| `KILL_PORT` | `4999` | local-only kill switch port |

`ALLOW_PASSWORD_SSH=true` re-enables the old wallet-address password (off by default — SSH is
key-only; the buyer supplies the public key).

## Safety model, briefly

- **The daemon holds no wallet** — only the `RAVEN_KEY` bearer. Payouts are signed server-side.
- **The buyer is contained by the tier** (gvisor/microvm), not by the daemon — which is exactly why
  a `container` node isn't rentable.
- **Egress is filtered per lease** (default-drop + allowlist, DNS to resolver, cloud-metadata/RFC1918
  blocked). A lease that slams the firewall past the limit is suspended.
- **Teardown is guaranteed:** each guest self-powers-off at a hard TTL and a host reaper reconciles
  live sandboxes against known leases — a sandbox never outlives the registry.
- **Docker-group membership ≈ root on the host.** Inherent to driving Docker. Run the daemon where
  that's acceptable; the systemd unit confines the daemon itself.
