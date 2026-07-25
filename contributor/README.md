# Become a RAVEN contributor

Share a machine's spare compute; get paid in SOL by the second. The daemon registers your host with a
RAVEN backend, and when a buyer rents it, boots a throwaway **gVisor sandbox** they `ssh` into. At
lease end you're paid on-chain automatically.

You run **one process** (this daemon). No wallet, no inbound ports, no private key on the box.

## The whole setup

On any ordinary Linux VM with Docker — no KVM, no bare metal:

```bash
git clone <this repo> raven && cd raven
sudo bash contributor/scripts/quickstart.sh rvn_ctb_… https://api.raven.example
```

That's it. The script installs gVisor, writes `contributor/.env`, installs dependencies and starts the
daemon; your node shows up in the marketplace's Explore table within ~10 seconds. It's idempotent, so
re-run it whenever you want. Get the `rvn_ctb_…` key from [Step 1](#step-1--get-your-raven_key); the
URL comes from whoever runs the marketplace. The rest of this page is what that one command does, and
how to tune it.

> **Every rentable lease runs in a virtualized kernel.** gVisor (`usermode-kernel`) intercepts guest
> syscalls in userspace, so a kernel exploit inside the sandbox hits gVisor's sentry, not your kernel
> — and unlike a microVM it needs no KVM, which is why it's the default. The `docker` backend
> (`container` tier) shares your host kernel: it exists for local development, shows **"Below min"**
> in the marketplace, and the registry refuses to place a lease on it.

---

## Requirements

| Need | Why | Notes |
|---|---|---|
| **A Linux host** | gVisor's `runsc` is Linux-only | any ordinary VM works — DigitalOcean, Hetzner, EC2, a spare box. macOS and Windows cannot host a rentable node. |
| **Docker** | the sandbox image is built and run through it, with `runsc` as the runtime | `docker ps` must work |
| **root (once)** | to install `runsc` and register it as a Docker runtime | the quickstart script needs `sudo`; after that the daemon only needs Docker access |
| **Node 22+** | to run the daemon | |
| **Outbound internet** | each lease's SSH port is published over a [bore](https://github.com/ekzhang/bore) tunnel | no inbound ports to open |
| **`RAVEN_KEY` + backend URL** | authenticates the node; where payouts go | key from the web app (Step 1); URL from the marketplace operator |

| Tier | `SANDBOX_BACKEND` | Boundary | Needs | Rentable? |
|---|---|---|---|---|
| `usermode-kernel` | `gvisor` | syscalls intercepted in userspace (runsc) | nothing beyond Docker | ✅ **the default** |
| `microvm` | `firecracker` | own guest kernel, KVM + jailer | `/dev/kvm`, root | ✅ stronger, more setup |
| `container` | `docker` | shared host kernel, namespaces only | — | ❌ below market minimum, local dev only |

Running the stronger microVM tier instead? Everything below still applies; swap Step 2 for
[Firecracker setup](#optional--the-microvm-tier) and set `SANDBOX_BACKEND=firecracker`.

---

## Start a node

### Step 1 — Get your `RAVEN_KEY`

1. Open the marketplace web app and flip the switch to **Contribute** (or go straight to `/contributor`).
2. **Connect Wallet** (Phantom / Solflare / Backpack) → **Sign in** (you sign a one-time nonce,
   nothing on-chain).
3. Click **Create key** and copy the `rvn_ctb_…` key. It's tied to your wallet; payouts go there. The
   daemon sends only this key — the backend resolves it to your payout address server-side. You can
   hold **two keys** at once (roll one while the other still runs) and revoke either from the same page.

### Step 2 — Everything else (one command)

```bash
sudo bash contributor/scripts/quickstart.sh rvn_ctb_… https://api.raven.example
```

Idempotent — safe to re-run. It installs gVisor, writes the config, installs dependencies and starts
the daemon. If you'd rather do those by hand, they're Steps 2a–2c:

**2a — gVisor**

```bash
sudo bash contributor/scripts/setup-gvisor.sh
```

Downloads `runsc` + the containerd shim for your architecture, verifies their SHA-512 sums, runs
`runsc install` (which registers the runtime in `/etc/docker/daemon.json`) and restarts Docker. Exits
immediately if `runsc` is already registered. Details: [docs/gvisor-setup.md](docs/gvisor-setup.md).

**2b — Configure**

```bash
cp contributor/.env.example contributor/.env
```

```ini
RAVEN_KEY=rvn_ctb_…                     # from Step 1
REGISTRY_URL=https://api.raven.example  # your backend
SANDBOX_BACKEND=gvisor                  # the default; clears the market minimum
```

Everything else has a default — see [Knobs](#knobs).

The daemon **refuses to start if the host can't deliver the configured backend** — it never advertises
a tier it can't honour. If it starts, the node is rentable.

**2c — Run**

```bash
npm install
npm run contributor
```

For a long-lived node install the systemd unit
([`systemd/raven-contributor.service`](systemd/raven-contributor.service)) — it keeps
`NoNewPrivileges`, `ProtectSystem=strict` and a `ReadWritePaths` allowlist around the daemon. Setup is
in that file's header.

### Step 3 — Verify it's rentable

- The startup line reports the tier: `sandbox backend: gvisor (tier usermode-kernel) — ready`, and the
  capability line above it shows `gvisor✓`.
- In the web app's **Explore** table the node's **Isolation** column reads `gVisor` and **Rent** is
  enabled (not "Below min").
- During a lease, on the host: `docker ps` shows the sandbox container running with `runsc`.
- Inside the lease: `dmesg | head` shows gVisor's own kernel banner, not your host's.

### Optional — the microVM tier

Stronger isolation (own guest kernel under KVM) on a host that has `/dev/kvm` — bare metal or a
nested-virt instance; standard cloud droplets don't qualify. Check first, then set up:

```bash
bash contributor/scripts/preflight-microvm.sh
sudo bash contributor/scripts/setup-firecracker.sh   # firecracker + jailer, guest kernel, NAT table
```

Then set `SANDBOX_BACKEND=firecracker` and run with `sudo -E npm run contributor` (root: tap devices
and a rootfs loop-mount). Details: [docs/microvm-setup.md](docs/microvm-setup.md). There is
deliberately **no `docker compose up contributor`** for this tier: Firecracker in a container needs
`--privileged` plus the Docker socket, which is full host root — the opposite of what it sells.

### Stop / panic

- Stop: `Ctrl-C`, or `systemctl stop raven-contributor`.
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
| `SANDBOX_BACKEND` | `gvisor` | `gvisor` (usermode-kernel, rentable), `firecracker` (microvm, rentable, needs KVM) or `docker` (container, dev only). The daemon fails to start if the host can't deliver it. |
| `FC_KERNEL` | `/var/lib/raven/vmlinux` | uncompressed guest kernel — `firecracker` only, ignored on `gvisor` |
| `FC_CACHE_DIR` | `/var/lib/raven/rootfs` | cached ext4 rootfs, keyed by image digest |
| `FC_STATE` | `/var/lib/raven` | per-lease network slots live in `$FC_STATE/slots` |
| `FC_CHROOT` | `/srv/jailer` | jailer chroot base |
| `FC_DNS` | `1.1.1.1` | resolver written into each guest's `/etc/resolv.conf` |
| `EGRESS_MODE` | `allowlist` | `allowlist` / `deny-all` / `open` — per-lease firewall on the guest's tap, advertised to buyers |
| `RATE_LAMPORTS_PER_HOUR` | `50000000` | price (0.05 SOL/hour) |
| `NODE_LABEL` | hostname | name shown in Explore |
| `SHARE_CPUS` | cores − 1 | vCPUs per lease |
| `SHARE_MEM_MB` | half of RAM | guest memory per lease |
| `TUNNEL_MODE` | `bore` | `bore` = outbound tunnel, no inbound ports; `local` = reach the guest's `/30` directly (same host/LAN only) |
| `BORE_SERVER` | `bore.pub` | bore relay for `TUNNEL_MODE=bore` |
| `REAP_INTERVAL_MS` | `60000` | orphan-sandbox reaper period |
| `KILL_PORT` | `4999` | local-only kill switch port |

`ALLOW_PASSWORD_SSH=true` (on the **registry**, not here) re-enables the old wallet-address password.
Off by default — SSH is key-only and the buyer supplies the public key.

## Safety model, briefly

- **The daemon holds no wallet** — only the `RAVEN_KEY` bearer. Payouts are signed server-side by the
  registry, never on this box.
- **The buyer is contained by the sandbox, not by the daemon.** On `gvisor`: every guest syscall is
  served by runsc's userspace sentry, with all capabilities dropped, a read-only root and `noexec`
  scratch tmpfs. On `firecracker`: a separate guest kernel, `jailer` chroot + uid/gid 30000 + cgroup
  slice, no host filesystem passed in. A plain `container` node offers neither, which is why it isn't
  rentable.
- **Each microVM lease gets its own `/30` and tap**, claimed atomically, so two concurrent leases can
  never share a subnet or see each other. gVisor leases get a per-container network namespace instead.
- **Egress is filtered per lease** (default-drop + the buyer's allowlist, DNS to the resolver only,
  cloud-metadata and RFC1918 blocked). A lease that slams the firewall past the limit gets suspended.
- **The SSH key is injected into a per-lease copy** of the rootfs, never the shared cache — one
  buyer's key can't reach the next lease.
- **Teardown is guaranteed:** the guest powers itself off at a hard TTL, and a host reaper reconciles
  live VMs against known leases every `REAP_INTERVAL_MS`, removing the tap, slot, jail and firewall.
- **Docker access is host root.** On `gvisor` the daemon needs no root of its own, but anything that
  can talk to the Docker socket can own the host, and on `firecracker` the daemon runs as root
  outright. Either way, treat a contributor box as dedicated to this job — see
  [docs/daemon-isolation.md](docs/daemon-isolation.md).
