# Become a RAVEN contributor

Share a machine's spare compute; get paid in SOL by the second. The daemon registers your host with a
RAVEN backend, and when a buyer rents it, boots a throwaway **Firecracker microVM** they `ssh` into.
At lease end you're paid on-chain automatically.

You run **one process** (this daemon). No wallet, no inbound ports, no private key on the box.

> **Every rentable lease is a Firecracker microVM.** The guest gets its own kernel under KVM, so a
> kernel bug inside the sandbox hits a VMM boundary, not your kernel. The daemon's other backend,
> `docker` (`container` tier), shares your host kernel — it exists for local development and shows
> **"Below min"** in the marketplace. It cannot be rented.
>
> **That means a contributor host must have `/dev/kvm`.**

---

## Requirements

| Need | Why | Notes |
|---|---|---|
| **A Linux host with `/dev/kvm`** | Firecracker is a KVM virtual machine monitor | **bare metal or a nested-virt instance.** macOS, Apple silicon under Colima/Lima, and standard DigitalOcean droplets do **not** expose KVM and cannot run a rentable node. Options: Hetzner/OVH dedicated, AWS EC2 `*.metal`, GCP with nested virt enabled, your own box. Check with `bash contributor/scripts/preflight-microvm.sh`. |
| **root** | each lease needs a tap device (`CAP_NET_ADMIN`) and a rootfs loop-mount (`CAP_SYS_ADMIN`) | the daemon refuses to start otherwise |
| **Docker** | the sandbox image is built with it, then exported to an ext4 rootfs | `docker ps` must work. Docker does *not* run the sandbox — Firecracker does. |
| **`firecracker` + `jailer`, a guest kernel, `nftables`, `e2fsprogs`, `iproute2`** | the microVM toolchain | one script installs all of it (Step 2) |
| **Node 22+** | to run the daemon | |
| **Outbound internet** | each lease's SSH port is published over a [bore](https://github.com/ekzhang/bore) tunnel | no inbound ports to open |
| **`RAVEN_KEY` + backend URL** | authenticates the node; where payouts go | key from the web app (Step 1); URL from the marketplace operator |

| Tier | `SANDBOX_BACKEND` | Boundary | Rentable? |
|---|---|---|---|
| `microvm` | `firecracker` | own guest kernel, KVM + jailer | ✅ **this is the one** |
| `container` | `docker` | shared host kernel, namespaces only | ❌ below market minimum, local dev only |

The registry is happy on an ordinary VM — **only the contributor daemon needs KVM.**

---

## Start a node

### Step 1 — Get your `RAVEN_KEY`

1. Open the marketplace web app and flip the switch to **Contribute** (or go straight to `/contributor`).
2. **Connect Wallet** (Phantom / Solflare / Backpack) → **Sign in** (you sign a one-time nonce,
   nothing on-chain).
3. Click **Create key** and copy the `rvn_ctb_…` key. It's tied to your wallet; payouts go there. The
   daemon sends only this key — the backend resolves it to your payout address server-side. You can
   hold **two keys** at once (roll one while the other still runs) and revoke either from the same page.

### Step 2 — Set up Firecracker (one command)

```bash
sudo bash contributor/scripts/setup-firecracker.sh
```

Idempotent — safe to re-run. It:

- refuses early, with a useful message, if the host has no KVM;
- installs `firecracker` + `jailer` into `/usr/local/bin`;
- fetches an uncompressed guest kernel to `/var/lib/raven/vmlinux`;
- installs `iproute2`, `e2fsprogs`, `nftables` if missing (apt hosts);
- creates `/var/lib/raven/{rootfs,slots}` and `/srv/jailer`;
- turns on `ip_forward` and installs the `raven_nat` nftables table that masquerades the guest
  `172.31.0.0/16` range — **without this a guest has no route out at all**, even for traffic its
  egress allowlist permits;
- finishes by running the preflight and printing the next steps.

Check any time:

```bash
bash contributor/scripts/preflight-microvm.sh
```

Details: [docs/microvm-setup.md](docs/microvm-setup.md).

### Step 3 — Configure

```bash
cp contributor/.env.example contributor/.env
```

```ini
RAVEN_KEY=rvn_ctb_…                     # from Step 1
REGISTRY_URL=https://api.raven.example  # your backend
SANDBOX_BACKEND=firecracker             # the default; the only rentable tier
```

Everything else has a default — see [Knobs](#knobs).

The daemon **refuses to start if the host can't deliver the configured backend** — it never advertises
a tier it can't honour. If it starts, the node is rentable.

### Step 4 — Run

```bash
npm install
sudo -E npm run contributor        # root: tap devices + rootfs loop-mount
```

For a long-lived node install the systemd unit
([`systemd/raven-contributor.service`](systemd/raven-contributor.service)) — it keeps
`NoNewPrivileges`, `ProtectSystem=strict` and a `ReadWritePaths` allowlist around the daemon while
still allowing what Firecracker needs. Setup is in that file's header.

There is deliberately **no `docker compose up contributor`**: Firecracker in a container would need
`--privileged` plus the Docker socket, which is full host root — the opposite of what this tier sells.

### Step 5 — Verify it's rentable

- The startup line reports the tier: `sandbox backend: firecracker (tier microvm) — ready`, and the
  capability line above it shows `firecracker✓`.
- In the web app's **Explore** table the node's **Isolation** column reads `microVM` and **Rent** is
  enabled (not "Below min").
- During a lease, on the host: `ps aux | grep firecracker` shows a jailed VMM (uid 30000),
  `ip link` shows the lease's `rvn<n>` tap, `nft list tables` shows `raven_<leaseId>`.
- Inside the lease: `uname -a` and `dmesg | head` show a **guest** kernel, not yours.

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
| `SANDBOX_BACKEND` | `firecracker` | `firecracker` (microvm, rentable) or `docker` (container, dev only). The daemon fails to start if the host can't deliver it. |
| `FC_KERNEL` | `/var/lib/raven/vmlinux` | uncompressed guest kernel |
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
- **The buyer is contained by the microVM**, not by the daemon: separate kernel, `jailer` chroot +
  uid/gid 30000 + cgroup slice, no host filesystem passed in. That's why a `container` node isn't
  rentable.
- **Each lease gets its own `/30` and tap**, claimed atomically, so two concurrent leases can never
  share a subnet or see each other.
- **Egress is filtered per lease** (default-drop + the buyer's allowlist, DNS to the resolver only,
  cloud-metadata and RFC1918 blocked). A lease that slams the firewall past the limit gets suspended.
- **The SSH key is injected into a per-lease copy** of the rootfs, never the shared cache — one
  buyer's key can't reach the next lease.
- **Teardown is guaranteed:** the guest powers itself off at a hard TTL, and a host reaper reconciles
  live VMs against known leases every `REAP_INTERVAL_MS`, removing the tap, slot, jail and firewall.
- **Running as root is real exposure.** The daemon drives KVM and the network stack, so treat a
  contributor box as dedicated to this job — see [docs/daemon-isolation.md](docs/daemon-isolation.md).
