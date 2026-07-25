# microVM tier setup (Firecracker + jailer)

The `microvm` tier gives each lease its own guest kernel under KVM, so hostile root inside the sandbox
is contained by a virtual machine boundary rather than namespaces. It is the only tier the marketplace
rents. `SANDBOX_BACKEND=firecracker`.

Run the preflight first — it prints one actionable line per missing piece and exits non-zero:

```bash
bash contributor/scripts/preflight-microvm.sh
```

## The hard requirement: /dev/kvm

Firecracker is a KVM virtual machine monitor, so the host must expose `/dev/kvm` — **bare metal or a
nested-virt-capable instance.**

> Does **not** work: macOS, Apple silicon under Colima/Lima, standard DigitalOcean droplets, most
> shared cloud VMs. The RAVEN registry, MongoDB and the web app run fine on an ordinary droplet; only
> the contributor daemon needs KVM.
>
> Works: Hetzner/OVH dedicated, AWS EC2 `*.metal`, GCP with nested virtualization enabled on the
> image, your own hardware.

If KVM is missing the daemon **fails at startup by design** — a node never advertises a tier it cannot
deliver. Your options are a different host, or `SANDBOX_BACKEND=docker` for local development only
(shared kernel, shows "Below min", not rentable).

## Setup

One command, idempotent:

```bash
sudo bash contributor/scripts/setup-firecracker.sh
```

It installs `firecracker` + `jailer` (pinned release, `x86_64`/`aarch64`), fetches an uncompressed
guest kernel to `/var/lib/raven/vmlinux`, installs `iproute2` / `e2fsprogs` / `nftables` when apt is
available, creates `/var/lib/raven/{rootfs,slots}` and `/srv/jailer`, enables `net.ipv4.ip_forward`,
and installs the `raven_nat` nftables table.

Override paths with `FC_KERNEL`, `FC_CACHE_DIR`, `FC_STATE`, `FC_CHROOT`, and the release with
`FC_VERSION`. Bring your own kernel by pointing `FC_KERNEL` at any uncompressed `vmlinux` built with
virtio and `CONFIG_IP_PNP` (the `ip=` boot arg configures the guest's interface).

## How a lease boots

1. **rootfs** — `fc-rootfs.sh` builds the sandbox image with Docker, `docker export`s it, and writes an
   ext4 filesystem with `mkfs.ext4 -d`. Cached by image digest, published with an atomic rename, and
   never mutated afterwards.
2. **network slot** — `fc-up.sh` claims the lowest free slot `1..250` with `mkdir` (atomic), giving the
   lease a tap `rvn<n>` and the `/30` `172.31.<n>.0/30` (host `.1`, guest `.2`). The slot directory
   records which lease owns it, so teardown and the reaper can find the tap again.
3. **per-lease copy** — the cached rootfs is copied into the jail *first*, then that copy is
   loop-mounted to inject `authorized_keys`, `/etc/resolv.conf`, and `/etc/raven-net.env` (TTL, IPs).
   The cache stays pristine, so one buyer's SSH key never reaches the next lease.
4. **launch** — always through `jailer`: its own chroot under `/srv/jailer/firecracker/<leaseId>`,
   uid/gid 30000, cgroup v2 slice, `--resource-limit fsize`. Never `firecracker` directly. The pid is
   written to `firecracker.pid`; the VMM's own output goes to `firecracker.log`.
5. **readiness** — the script polls the guest's port 22 and only then reports success, so the registry
   never marks a lease `active` before sshd answers.
6. **reachability** — the `/30` is host-local, so the guest's port 22 is published to the buyer over a
   bore tunnel (`TUNNEL_MODE=bore`, the default). With `TUNNEL_MODE=local` the guest IP is returned
   directly, which only helps on the same host or LAN.
7. **guest init** — the kernel runs `init=/start.sh`, the same script the container tier uses as its
   `CMD`. It mounts `/proc`, `/sys`, `/dev`, `/dev/pts`, sources `/etc/raven-net.env`, configures
   key-only sshd, and arms the TTL self-poweroff.

## Egress

Two separate nftables tables, on purpose:

- **`raven_nat`** (installed once by the setup script) masquerades `172.31.0.0/16` so guests have a
  route out at all.
- **`raven_<leaseId>`** (written per lease by the daemon, `src/net/nft.ts`) is the actual policy on that
  lease's tap: default-drop forward, DNS to the resolver, the buyer's allowlist, cloud-metadata and
  RFC1918 dropped, a new-connection rate limit, and a drop counter reported on every heartbeat.

## Teardown

`fc-down.sh` is idempotent: TERM then KILL the pid (with a `pkill -f "firecracker.*--id <lease>"`
backstop), free the network slot and delete its tap, remove the jail. The reaper calls the same path
for orphans, and `fc-list.sh` hands it the tap name so the lease's firewall is removed too. The guest
also powers itself off at its hard TTL, so a VM never outlives the registry.

## Verifying isolation

On the host, during a lease:

```bash
ps aux | grep firecracker      # jailed VMM running as uid 30000
ip link                        # the lease's rvn<n> tap
nft list tables                # raven_nat plus raven_<leaseId>
```

Inside the lease:

```bash
uname -a                       # a guest kernel, not the host's
dmesg | head                   # Firecracker guest boot
```
