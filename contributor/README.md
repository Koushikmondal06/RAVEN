# Become a RAVEN contributor

Share a machine's spare compute; get paid in SOL by the second. The daemon registers your host with
a RAVEN backend, and when a buyer rents it, launches a hardened, throwaway sandbox they `ssh` into.
At lease end you're paid on-chain automatically.

You run **one process** (this daemon). It needs Docker and a `RAVEN_KEY`. No wallet, no inbound
ports, no keys on the box.

---

## 1. Prerequisites

- **Docker** running on the host (`docker ps` works).
- **Node 22+** if running natively (recommended), *or* Docker Compose if running the demo way.
- Outbound internet (each sandbox dials out over a [bore](https://github.com/ekzhang/bore) tunnel —
  no ports to open).
- A **RAVEN backend URL** to point at (the marketplace operator gives you this, e.g.
  `https://api.raven.example`). For local testing it's `http://localhost:4000`.

## 2. Get your `RAVEN_KEY`

1. Open the marketplace web app → **Become a Contributor** (`/contributor`).
2. **Connect Wallet** (Phantom / Solflare / Backpack) and **Sign in** — you sign a one-time nonce,
   nothing on-chain.
3. The page shows an `rvn_ctb_…` key. That's your `RAVEN_KEY`. It's tied to your wallet address;
   payouts go there. Copy it.

The daemon sends only this key. The backend resolves it to your payout address server-side — the box
never holds a private key.

## 3. Choose an isolation tier

A node advertises the strongest boundary it can actually deliver; the marketplace won't rent a node
below its minimum (currently **gVisor or stronger**). Pick with `SANDBOX_BACKEND`:

| `SANDBOX_BACKEND` | Tier | Boundary | Needs | Rentable? |
|---|---|---|---|---|
| `docker` | `container` | shared host kernel, namespaces only | nothing | ❌ below market min |
| `gvisor` | `usermode-kernel` | syscalls intercepted in userspace (runsc) | `runsc` (one script) | ✅ **recommended** |
| `kata-fc` / `firecracker` | `microvm` | separate guest kernel over KVM | `/dev/kvm`, nested virt | ✅ if you have KVM |

**Use `gvisor` unless you have a bare-metal / nested-virt host.** It gives each lease a real
virtualized kernel with **no KVM**, so it runs on ordinary cloud VMs. `docker` alone is not rentable
on the public marketplace (shared kernel). If the configured backend isn't available at startup the
daemon **refuses to register** rather than advertising a tier it can't deliver.

### gVisor one-time host setup

```bash
sudo bash contributor/scripts/setup-gvisor.sh     # installs runsc, registers the Docker runtime
docker info --format '{{json .Runtimes}}' | grep runsc   # verify
```

Idempotent — safe to re-run. Details: [docs/gvisor-setup.md](docs/gvisor-setup.md).
For the `microvm` tier see [docs/microvm-setup.md](docs/microvm-setup.md) (needs `/dev/kvm`; check
with `bash contributor/scripts/preflight-microvm.sh`).

## 4. Configure

```bash
cp contributor/.env.example contributor/.env
```

Edit `contributor/.env` — only two are required:

```ini
RAVEN_KEY=rvn_ctb_…                    # from step 2
REGISTRY_URL=https://api.raven.example # your backend
SANDBOX_BACKEND=gvisor                 # recommended (see step 3)
```

Everything else has a default (see the [knobs table](#knobs) below).

## 5. Run

### Native (recommended — production)

Run the daemon as a normal host process. It drives Docker but there's no socket-mounted container to
compromise.

```bash
npm install
SANDBOX_BACKEND=gvisor npm run contributor
```

For a long-lived node, install the systemd unit ([`systemd/raven-contributor.service`](systemd/raven-contributor.service)),
which adds `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, and a `ReadWritePaths` allowlist.
Setup steps are in that file's header.

### Docker Compose (demo / quick start)

```bash
# contributor/.env: RAVEN_KEY, REGISTRY_URL, SANDBOX_BACKEND=gvisor
docker compose up --build -d contributor
docker compose logs -f contributor
```

The daemon mounts the host Docker socket and launches each sandbox as a sibling container on the host
daemon — so `gvisor` works here too (runsc lives on the host). **Security caveat:** that socket mount
gives the container host root. Fine for a demo; for a real machine run natively (above). See
[docs/daemon-isolation.md](docs/daemon-isolation.md).

## 6. Verify it's live

- Daemon log prints the tier it registered (e.g. `registered … isolation=usermode-kernel`).
- The node appears in the web app's **Explore** table with its isolation + egress badges and a
  **Rent** button (not "Below min").
- During a lease, `docker ps` on the host shows the sandbox; for gVisor it runs `--runtime=runsc`.

## 7. Stop / panic

- Stop the daemon: `Ctrl-C` (native) or `docker compose down` (compose).
- **Kill switch** — tear down every sandbox at once, locally:
  ```bash
  curl -X POST http://127.0.0.1:4999/kill      # KILL_PORT, 127.0.0.1 only
  ```

---

## Knobs

All optional except `RAVEN_KEY` / `REGISTRY_URL`. Defaults shown.

| Var | Default | Meaning |
|---|---|---|
| `RAVEN_KEY` | — | **required** — your `rvn_ctb_…` key |
| `REGISTRY_URL` | `http://localhost:4000` | backend to register with |
| `SANDBOX_BACKEND` | `docker` | `docker` / `gvisor` / `kata-fc` / `firecracker` — daemon fails to start if the host can't deliver it |
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
key-only, buyer supplies the public key).

## Safety model, briefly

- **The daemon holds no wallet** — only the `RAVEN_KEY` bearer. Payouts are signed server-side.
- **The buyer is contained by the tier** (gvisor/microvm), not by the daemon. Run a rentable tier.
- **Egress is filtered per lease** (default-drop + allowlist, DNS to resolver, cloud-metadata/RFC1918
  blocked). A lease that slams the firewall past the limit is suspended.
- **Teardown is guaranteed:** each guest self-powers-off at a hard TTL and a host reaper reconciles
  live sandboxes against known leases — a sandbox never outlives the registry.
- **Docker-group membership ≈ root on the host.** Inherent to driving Docker. Run the daemon on a
  machine where that's acceptable; the systemd unit confines the daemon itself.
