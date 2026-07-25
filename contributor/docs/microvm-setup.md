# microVM tier setup (Kata + Firecracker)

The `microvm` tier gives each lease its own guest kernel over KVM, so a hostile root inside the
sandbox is contained by a VM boundary, not just namespaces. It needs hardware virtualization.

Run the preflight first — it prints one actionable line per missing piece:

```bash
bash contributor/scripts/preflight-microvm.sh
```

## The hard requirement: /dev/kvm

The microVM tier needs `/dev/kvm`, which means **bare metal or a nested-virt-capable instance**.

> Standard DigitalOcean droplets do NOT expose `/dev/kvm`. The registry and MongoDB can live on a DO
> droplet fine; the `microvm` tier cannot. Use bare metal (Equinix, Hetzner dedicated, a homelab box)
> or a cloud instance that advertises nested virtualization.

If `/dev/kvm` is absent, `SANDBOX_BACKEND=kata-fc` fails at startup by design — a node never
advertises a tier it cannot deliver. Fall back to `SANDBOX_BACKEND=gvisor` (no KVM needed) on those
hosts.

## Host prerequisites

Per distro, roughly:

- **Ubuntu/Debian:** install `containerd`, `nerdctl`, Kata Containers (`kata-runtime`,
  `containerd-shim-kata-fc-v2`), and a Firecracker binary; add the daemon user to the `kvm` group;
  configure the `io.containerd.kata-fc.v2` runtime with Firecracker as the hypervisor in
  `/etc/kata-containers/configuration-fc.toml`.
- **Fedora/RHEL:** same components via `dnf`; SELinux may need a permissive/adjusted policy for the
  shim.

## What the backend enforces

- One guest kernel per lease via `--runtime io.containerd.kata-fc.v2`.
- cgroup v2 limits on the VMM process (`--cpus`, `--memory`, `--pids-limit`).
- Ephemeral rootfs, `--read-only` with a `noexec,nosuid` tmpfs for scratch. No shared writable
  mounts, ever.
- The image is built into containerd's store with `nerdctl build` (separate from Docker's store).

## Verifying isolation

After a lease starts, `ssh` in and confirm you are in a VM, not a container: `dmesg | head` should
show a Firecracker/Kata guest kernel boot, and the kernel version should differ from the host's.
